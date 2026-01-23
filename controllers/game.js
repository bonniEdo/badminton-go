const knex = require("../db");
const validator = require("validator");
const AppError = require("../utils/appError");
const { GameStatus } = require('../utils/gameHelpers');




const createGame = async (req, res) => {
    const userId = req.user.id;
    const { title, gameDate, gameTime, endTime, location, maxPlayers, price, notes } = req.body;
    const gameDateTime = `${gameDate} ${gameTime}`;

    if (!title) throw new AppError("缺少名稱", 400);
    if (!gameDate) throw new AppError("缺少日期", 400);
    if (!validator.isDate(gameDate, { format: "YYYY-MM-DD", strictMode: true })) {
        throw new AppError("日期格式錯誤，請使用 YYYY-MM-DD 格式", 400);
    }
    if (!maxPlayers) throw new AppError("缺少人數上限", 400);

    if (!gameTime) throw new AppError("缺少開始時間", 400);
    if (!validator.isTime(gameTime, { hourFormat: "hour24" })) {
        throw new AppError("時間格式錯誤，請使用24小時制 hh:mm 格式", 400);
    }

    if (!endTime) throw new AppError("缺少結束時間", 400);
    if (!validator.isTime(endTime, { hourFormat: "hour24" })) {
        throw new AppError("時間格式錯誤，請使用24小時制 hh:mm 格式", 400);
    }
    if (endTime <= gameTime) {
        throw new AppError("結束時間必須晚於開始時間", 400);
    }

    const existingGame = await knex("Games")
        .where({
            HostID: userId,
            GameDateTime: gameDateTime,
            Location: location,
            IsActive: true,
        })
        .first();

    if (existingGame) {
        throw new AppError("已有同時段同地點團囉！請勿重複建立。", 400);
    }

    const newGame = await knex.transaction(async (trx) => {
        const [insertedGame] = await trx("Games")
            .insert({
                Title: title,
                GameDateTime: gameDateTime,
                EndTime: endTime,
                Location: location,
                MaxPlayers: Number(maxPlayers),
                Price: Number(price),
                HostID: userId,
                IsActive: true,
                Notes: notes,
            })
            .returning("*");

        await trx("GamePlayers").insert({
            GameId: insertedGame.GameId,
            UserId: userId,
            Status: "CONFIRMED",
            JoinedAt: knex.fn.now(),
        });

        return insertedGame;
    });

    res.status(201).json({
        success: true,
        message: "開團成功",
        game: newGame,
    });
};

const currentPlayersSubquery = () => {
    return knex("GamePlayers")
        .whereColumn("GamePlayers.GameId", "Games.GameId")
        .where("Status", "CONFIRMED")
        .whereNull("GamePlayers.CanceledAt")
        .select(knex.raw('COALESCE(SUM(1 + COALESCE("FriendCount", 0)), 0)'))
        .as("CurrentPlayersCount");
};

const totalCountSubquery = () => {
    return knex("GamePlayers")
        .whereColumn("GamePlayers.GameId", "Games.GameId")
        .whereNull("GamePlayers.CanceledAt")
        .whereNot("GamePlayers.Status", "CANCELED")
        .select(knex.raw('COALESCE(SUM(1 + COALESCE("FriendCount", 0)), 0)'))
        .as("TotalCount");
};



const getGame = async (req, res) => {
    const userId = req.user.id;


    const activeGames = await knex("Games")
        .whereNull("CanceledAt")
        .where({
            HostID: userId,
            IsActive: true,
        })
        .select(
            "Games.GameId",
            "Games.Title",
            "Games.GameDateTime",
            "Games.Location",
            "Games.EndTime",
            "Games.Price",
            "Games.MaxPlayers",
            "Games.HostID",
            "Games.Notes",
            currentPlayersSubquery(), // 原有的（可能只算正取）
            totalCountSubquery()      // ✅ 新增的：算所有人頭
        )
        .orderBy("Games.GameDateTime", "desc");

    const processedGames = GameStatus(activeGames);
    const sortedGames = processedGames.sort((a, b) => a.isExpired - b.isExpired);

    res.status(200).json({
        success: true,
        data: sortedGames,
    });
};

const getAllGames = async (req, res) => {
    const userId = req.user?.id || null;
    const activeGames = await knex("Games")
        .join("Users", "Games.HostID", "Users.Id")
        .whereNull("Games.CanceledAt")
        .select(
            "Games.GameId",
            "Games.Title",
            "Games.GameDateTime",
            "Games.Location",
            "Games.EndTime",
            "Games.Price",
            "Games.MaxPlayers",
            "Games.Notes",
            knex.raw(
                `(SELECT "FriendCount" FROM "GamePlayers" 
                  WHERE "GamePlayers"."GameId" = "Games"."GameId" 
                  AND "GamePlayers"."UserId" = ? 
                  AND "GamePlayers"."Status" != 'CANCELED' 
                  LIMIT 1) as MyFriendCount`,
                [userId]
            ),

            knex.ref("Users.Username").as("hostName"), // ✅ 這裡改 Username（大寫U）
            currentPlayersSubquery(),
            totalCountSubquery()
        )
        .orderBy("Games.GameDateTime", "desc");
    const processedGames = GameStatus(activeGames);
    const sortedGames = processedGames.sort((a, b) => a.isExpired - b.isExpired);
    res.status(200).json({
        success: true,
        data: sortedGames,
    });
};

const deleteGame = async (req, res) => {
    const gameId = req.params.id;
    const userId = req.user.id;

    if (!gameId) {
        return res.status(400).json({ success: false, message: "缺少球團名稱" });
    }

    const game = await knex("Games").where({ GameId: gameId }).first();
    if (!game) throw new AppError("找不到此球團", 404);

    if (String(game.HostID) !== String(userId)) {
        return res.status(403).json({ success: false, message: "權限不足，只有團主可以取消此團" });
    }

    if (!game.IsActive || game.CanceledAt) {
        throw new AppError("此團已經取消過了", 400);
    }

    const [updatedGame] = await knex("Games")
        .where({ GameId: gameId })
        .update({
            IsActive: false,
            CanceledAt: knex.fn.now(),
        })
        .returning("*");

    res.status(200).json({
        success: true,
        message: "取消成功",
        game: updatedGame,
    });
};

const joinGame = async (req, res) => {
    const gameId = req.params.id;
    const userId = req.user.id;
    const { phone, includeFriend, numPlayers } = req.body;

    const friendCount = (
        includeFriend === true ||
        includeFriend === "true" ||
        Number(numPlayers) === 2
    ) ? 1 : 0;

    const totalToJoin = 1 + friendCount;

    const result = await knex.transaction(async (trx) => {
        const existingRecord = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId })
            .forUpdate() // <--- 加入這個，防止同時多個 insert
            .first();

        const game = await trx("Games").where({ GameId: gameId }).forUpdate().first();
        if (!game) throw new AppError("沒有此球團", 404);
        if (!game.IsActive || game.CanceledAt) throw new AppError("此團已被取消", 400);
        if (!phone) throw new AppError("缺少電話", 400);

        if (existingRecord && existingRecord.Status !== "CANCELED") {
            throw new AppError("已經報名過囉", 400);
        }

        const resCount = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED" })
            .sum({ total: trx.raw('1 + "FriendCount"') })
            .first();

        const confirmedCount = Number(resCount.total || 0);
        const maxPlayers = Number(game.MaxPlayers);

        let status = "CONFIRMED";
        let waitlistOrder = null;

        if (confirmedCount + totalToJoin > maxPlayers) {
            status = "WAITLIST";
            const waitResult = await trx("GamePlayers")
                .where({ GameId: gameId, Status: "WAITLIST" })
                .count("* as count")
                .first();
            waitlistOrder = Number(waitResult.count) + 1;
        }

        const payload = {
            Status: status,
            PhoneNumber: phone,
            FriendCount: friendCount,
            JoinedAt: trx.fn.now(),
            CanceledAt: null,
        };

        let playerRecord;
        if (existingRecord) {
            await trx("GamePlayers").where({ GameId: gameId, UserId: userId }).update(payload);
        } else {
            await trx("GamePlayers").insert({ GameId: gameId, UserId: userId, ...payload });
        }

        const finalCountRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED" })
            .sum({ total: trx.raw('1 + "FriendCount"') })
            .first();

        const finalTotal = Number(finalCountRes.total || 0);
        await trx("Games").where({ GameId: gameId }).update({ CurrentPlayers: finalTotal });

        return { playerRecord, finalTotal, status, waitlistOrder };
    });

    res.status(201).json({
        success: true,
        message: result.status === "CONFIRMED" ? "報名成功" : `名額已滿，你目前是整組候補第 ${result.waitlistOrder} 位`,
        game: result.playerRecord,
        currentPlayers: result.finalTotal,
    });
};


const getJoinedGames = async (req, res) => {
    const userId = req.user.id;

    const joinedGames = await knex("GamePlayers")
        .join("Games", "GamePlayers.GameId", "Games.GameId")
        .where("GamePlayers.UserId", userId)
        .whereNot("GamePlayers.Status", "CANCELED")
        .whereIn("GamePlayers.Status", ["CONFIRMED", "WAITLIST"])
        .select(
            "Games.GameId",
            "Games.Title",
            "Games.GameDateTime",
            "Games.Location",
            "Games.EndTime",
            "Games.Price",
            "Games.MaxPlayers",
            knex.ref("GamePlayers.Status").as("MyStatus"),
            "GamePlayers.JoinedAt",
            "GamePlayers.FriendCount",
            "Games.Notes",
            currentPlayersSubquery(),
            totalCountSubquery()
        )
        .orderBy("Games.GameDateTime", "desc");
    const processedGames = GameStatus(joinedGames);
    const sortedGames = processedGames.sort((a, b) => a.isExpired - b.isExpired);
    res.status(200).json({
        success: true,
        data: sortedGames,
    });
};

const cancelJoin = async (req, res) => {
    const gameId = parseInt(req.params.id);
    const userId = req.user?.id;
    const { cancelType = 'all' } = req.body;

    console.log(`\n--- [DEBUG: cancelJoin] ---`);
    console.log(`User: ${userId}, Game: ${gameId}, Type: ${cancelType}`);

    const result = await knex.transaction(async (trx) => {
        const player = await trx("GamePlayers").where({ GameId: gameId, UserId: userId }).first();
        const game = await trx("Games").where({ GameId: gameId }).forUpdate().first();

        if (!player || player.Status === "CANCELED") throw new Error("找不到報名紀錄");

        console.log(`[DEBUG] 更新前 - 狀態: ${player.Status}, 朋友數: ${player.FriendCount}`);

        let message = "";
        if (cancelType === 'friend_only' && player.FriendCount > 0) {
            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId })
                .update({ FriendCount: 0 });
            message = "已取消朋友報名，保留本人名額";
        } else {
            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId })
                .update({
                    Status: "CANCELED",
                    CanceledAt: trx.fn.now(),
                    FriendCount: 0
                });
            message = "已成功取消報名";
        }

        let promotedCount = 0;
        while (true) {
            const confRes = await trx("GamePlayers")
                .where({ GameId: gameId, Status: "CONFIRMED" })
                .sum({ total: trx.raw('1 + "FriendCount"') })
                .first();

            const currentTotal = Number(confRes.total || 0);
            const space = game.MaxPlayers - currentTotal;

            if (space <= 0) break;

            const nextWait = await trx("GamePlayers")
                .where({ GameId: gameId, Status: "WAITLIST" })
                .orderBy("JoinedAt", "asc")
                .first();

            if (!nextWait) break;

            const nextSize = 1 + (nextWait.FriendCount || 0);
            if (nextSize <= space) {
                await trx("GamePlayers")
                    .where({ GameId: gameId, UserId: nextWait.UserId })
                    .update({ Status: "CONFIRMED", PromotedAt: trx.fn.now() });
                promotedCount++;
            } else {
                break;
            }
        }

        const finalCountRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED" })
            .sum({ total: trx.raw('1 + "FriendCount"') })
            .first();
        const finalTotal = Number(finalCountRes.total || 0);
        await trx("Games").where({ GameId: gameId }).update({ CurrentPlayers: finalTotal });

        console.log(`[DEBUG] 更新後 - 本人狀態: ${player.Status}, 最終總人數: ${finalTotal}`);
        return { promotedCount, finalTotal, message };
    });

    res.status(200).json({
        success: true,
        message: result.promotedCount > 0 ? `${result.message}，並自動遞補 ${result.promotedCount} 組候補` : result.message,
        currentPlayers: result.finalTotal
    });
};



const playerList = async (req, res) => {
    const gameId = req.params.id;

    const players = await knex("GamePlayers")
        .join("Users", "GamePlayers.UserId", "Users.Id")
        .select(
            "Users.Username",
            "GamePlayers.Status",
            "GamePlayers.JoinedAt",
            "GamePlayers.FriendCount"
        )
        .where("GamePlayers.GameId", gameId)
        .whereNull("GamePlayers.CanceledAt")
        .orderBy("GamePlayers.JoinedAt", "asc");

    const totalHeadCount = players.reduce((sum, p) => sum + 1 + (p.FriendCount || 0), 0);

    res.json({
        success: true,
        data: players,
        count: totalHeadCount
    });
};

const addFriend = async (req, res) => {
    const gameId = parseInt(req.params.id);
    const userId = req.user?.id;


    const result = await knex.transaction(async (trx) => {
        const player = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId })
            .forUpdate()
            .first();

        if (!player || player.Status === "CANCELED") throw new Error("尚未報名，請先報名");

        if (Number(player.FriendCount || 0) >= 1) {
            throw new Error("每人最多只能帶一位朋友 (+1)");
        }

        const newFriendCount = (player.FriendCount || 0) + 1;
        await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId })
            .update({ FriendCount: 1 });

        const confRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED" })
            .sum({ total: trx.raw('1 + "FriendCount"') })
            .first();

        const currentConfirmedTotal = Number(confRes.total || 0);
        const game = await trx("Games").where({ GameId: gameId }).forUpdate().first();

        if (player.Status === "CONFIRMED" && currentConfirmedTotal > game.MaxPlayers) {
            console.log(`[DEBUG] 人數爆滿，將使用者 ${userId} 轉為 WAITLIST`);
            await trx("GamePlayers").where({ GameId: gameId, UserId: userId }).update({ Status: "WAITLIST" });
        }

        const finalCountRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED" })
            .sum({ total: trx.raw('1 + "FriendCount"') })
            .first();
        const finalTotal = Number(finalCountRes.total || 0);
        await trx("Games").where({ GameId: gameId }).update({ CurrentPlayers: finalTotal });

        return { finalTotal };
    });

    res.status(200).json({ success: true, message: "已成功為朋友 +1 位", currentPlayers: result.finalTotal });
};


module.exports = {
    createGame,
    getGame,
    getAllGames,
    deleteGame,
    joinGame,
    getJoinedGames,
    cancelJoin,
    playerList,
    addFriend
};
