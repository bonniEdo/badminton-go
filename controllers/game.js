const knex = require("../db");
const validator = require("validator");
const AppError = require("../utils/appError");

const currentPlayersSubquery = () => {
    return knex("GamePlayers")
        .whereRaw('"GamePlayers"."GameId" = "Games"."GameId"')
        .where("Status", "CONFIRMED")
        .sum({ total: knex.raw('1 + "FriendCount"') })
        .as("CurrentPlayersCount");
};



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
            currentPlayersSubquery()
        )
        .orderBy("Games.GameDateTime", "desc");

    res.status(200).json({
        success: true,
        data: activeGames,
    });
};

const getAllGames = async (req, res) => {
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
            knex.ref("Users.Username").as("hostName"), // ✅ 這裡改 Username（大寫U）
            currentPlayersSubquery()
        )
        .orderBy("Games.GameDateTime", "desc");

    res.status(200).json({
        success: true,
        data: activeGames,
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
        const game = await trx("Games").where({ GameId: gameId }).forUpdate().first();
        if (!game) throw new AppError("沒有此球團", 404);
        if (!game.IsActive || game.CanceledAt) throw new AppError("此團已被取消", 400);
        if (!phone) throw new AppError("缺少電話", 400);

        const existingRecord = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId })
            .first();

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
            [playerRecord] = await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId })
                .update(payload)
                .returning("*");
        } else {
            [playerRecord] = await trx("GamePlayers")
                .insert({ GameId: gameId, UserId: userId, ...payload })
                .returning("*");
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
            currentPlayersSubquery()
        )
        .orderBy("Games.GameDateTime", "desc");

    res.status(200).json({
        success: true,
        data: joinedGames,
    });
};

const cancelJoin = async (req, res) => {
    const gameId = parseInt(req.params.id);
    const userId = req.user?.id;

    if (!gameId || isNaN(gameId)) {
        return res.status(400).json({ success: false, message: "無效的球局 ID" });
    }
    if (!userId) {
        return res.status(401).json({ success: false, message: "未經授權" });
    }

    const { cancelType = 'all' } = req.body;

    const result = await knex.transaction(async (trx) => {
        const player = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId })
            .first();
        const game = await trx("Games").where({ GameId: gameId }).forUpdate().first();

        if (!player || player.Status === "CANCELED") throw new AppError("找不到報名紀錄", 404);

        const oldStatus = player.Status;
        let message = "";

        if (cancelType === 'friend_only' && player.FriendCount > 0) {
            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId })
                .update({
                    FriendCount: 0,
                });
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

        if (oldStatus === "CONFIRMED") {
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
        }

        const finalCountRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED" })
            .sum({ total: trx.raw('1 + "FriendCount"') })
            .first();

        const finalTotal = Number(finalCountRes.total || 0);
        await trx("Games").where({ GameId: gameId }).update({ CurrentPlayers: finalTotal });

        return { promotedCount, finalTotal, message };
    });

    res.status(200).json({
        success: true,
        message: result.promotedCount > 0
            ? `${result.message}，並自動遞補 ${result.promotedCount} 組候補`
            : result.message,
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

module.exports = {
    createGame,
    getGame,
    getAllGames,
    deleteGame,
    joinGame,
    getJoinedGames,
    cancelJoin,
    playerList,
};
