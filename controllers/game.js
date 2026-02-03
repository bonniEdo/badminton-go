const knex = require("../db");
const validator = require("validator");
const AppError = require("../utils/appError");
const { GameStatus } = require('../utils/gameHelpers');

const locationSelect = knex.raw(`
    "Games"."Location" || 
    CASE 
        WHEN ("Games"."CourtNumber" IS NOT NULL AND "Games"."CourtNumber" != '') 
             OR ("Games"."CourtCount" > 1)
        THEN ' (' || 
             COALESCE("Games"."CourtNumber", '') || 
             CASE WHEN ("Games"."CourtNumber" IS NOT NULL AND "Games"."CourtNumber" != '') AND "Games"."CourtCount" > 1 THEN ' / ' ELSE '' END ||
             CASE WHEN "Games"."CourtCount" > 1 THEN "Games"."CourtCount" || '面場' ELSE '' END || 
             ')'
        ELSE ''
    END as "Location"
`);


// const createGame = async (req, res) => {
//     const userId = req.user.id;
//     const { title, gameDate, gameTime, endTime, location, maxPlayers, price, notes, phone } = req.body;
//     const gameDateTime = `${gameDate} ${gameTime}`;

//     if (!title) throw new AppError("缺少名稱", 400);
//     if (!gameDate) throw new AppError("缺少日期", 400);
//     if (!validator.isDate(gameDate, { format: "YYYY-MM-DD", strictMode: true })) {
//         throw new AppError("日期格式錯誤，請使用 YYYY-MM-DD 格式", 400);
//     }
//     if (!maxPlayers) throw new AppError("缺少人數上限", 400);

//     if (!gameTime) throw new AppError("缺少開始時間", 400);
//     if (!validator.isTime(gameTime, { hourFormat: "hour24" })) {
//         throw new AppError("時間格式錯誤，請使用24小時制 hh:mm 格式", 400);
//     }

//     if (!endTime) throw new AppError("缺少結束時間", 400);
//     if (!validator.isTime(endTime, { hourFormat: "hour24" })) {
//         throw new AppError("時間格式錯誤，請使用24小時制 hh:mm 格式", 400);
//     }
//     if (endTime <= gameTime) {
//         throw new AppError("結束時間必須晚於開始時間", 400);
//     }

//     const existingGame = await knex("Games")
//         .where({
//             HostID: userId,
//             GameDateTime: gameDateTime,
//             Location: location,
//             IsActive: true,
//         })
//         .first();

//     if (existingGame) {
//         throw new AppError("已有同時段同地點團囉！請勿重複建立。", 400);
//     }

//     const newGame = await knex.transaction(async (trx) => {
//         const [insertedGame] = await trx("Games")
//             .insert({
//                 Title: title,
//                 GameDateTime: gameDateTime,
//                 EndTime: endTime,
//                 Location: location,
//                 MaxPlayers: Number(maxPlayers),
//                 Price: Number(price),
//                 HostID: userId,
//                 IsActive: true,
//                 Notes: notes,
//                 HostContact: phone,
//             })
//             .returning("*");

//         await trx("GamePlayers").insert({
//             GameId: insertedGame.GameId,
//             UserId: userId,
//             Status: "CONFIRMED",
//             JoinedAt: knex.fn.now(),
//         });

//         return insertedGame;
//     });

//     res.status(201).json({
//         success: true,
//         message: "開團成功",
//         game: newGame,
//     });
// };
const createGame = async (req, res) => {
    const userId = req.user.id;
    const {
        title, gameDate, gameTime, endTime, location,
        courtNumber, courtCount, // 新增
        maxPlayers, price, notes, phone
    } = req.body;

    const gameDateTime = `${gameDate} ${gameTime}`;
    const existingGame = await knex("Games")
        .where({
            HostID: userId,
            GameDateTime: gameDateTime,
            Location: location,
            CourtNumber: courtNumber || null,
            IsActive: true,
        })
        .first();

    if (existingGame) {
        throw new AppError("已有同時段同地點同場地的團囉！", 400);
    }

    const newGame = await knex.transaction(async (trx) => {
        const [insertedGame] = await trx("Games")
            .insert({
                Title: title,
                GameDateTime: gameDateTime,
                EndTime: endTime,
                Location: location,
                CourtNumber: courtNumber,
                CourtCount: Number(courtCount) || 1,
                MaxPlayers: Number(maxPlayers),
                Price: Number(price),
                HostID: userId,
                IsActive: true,
                Notes: notes,
                HostContact: phone,
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

    res.status(201).json({ success: true, message: "開團成功", game: newGame });
};

const currentPlayersSubquery = () => {
    return knex("GamePlayers")
        .whereColumn("GamePlayers.GameId", "Games.GameId")
        .where("Status", "CONFIRMED")
        .whereNull("GamePlayers.CanceledAt")
        .count("*")
        .as("CurrentPlayersCount");
};

const totalCountSubquery = () => {
    return knex("GamePlayers")
        .whereColumn("GamePlayers.GameId", "Games.GameId")
        .whereNull("GamePlayers.CanceledAt")
        .whereNot("GamePlayers.Status", "CANCELED")
        .count("*")
        .as("TotalCount");
};

const getGame = async (req, res) => {
    const userId = req.user.id;


    const activeGames = await knex("Games")
        .where({
            HostID: userId,
        })
        .select(
            "Games.GameId",
            "Games.Title",
            "Games.GameDateTime",
            locationSelect,
            "Games.EndTime",
            "Games.Price",
            "Games.MaxPlayers",
            "Games.HostID",
            "Games.Notes",
            "Games.HostContact",
            "Games.CanceledAt",
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

const getAllGames = async (req, res) => {
    const userId = req.user?.id || null;
    const activeGames = await knex("Games")
        .join("Users", "Games.HostID", "Users.Id")
        .whereNull("Games.CanceledAt")
        .select(
            "Games.GameId",
            "Games.Title",
            "Games.GameDateTime",
            locationSelect,
            "Games.EndTime",
            "Games.Price",
            "Games.MaxPlayers",
            "Games.Notes",
            "Games.HostContact",
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
    const { phone, numPlayers } = req.body;

    const friendCount = Number(numPlayers) === 2 ? 1 : 0;
    const totalToJoin = 1 + friendCount;

    const result = await knex.transaction(async (trx) => {
        const game = await trx("Games").where({ GameId: gameId }).forUpdate().first();
        if (!game) throw new AppError("沒有此球團", 404);
        if (!game.IsActive || game.CanceledAt) throw new AppError("此團已被取消", 400);
        if (!phone) throw new AppError("缺少電話", 400);

        const existingRecord = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId, IsVirtual: false })
            .first();

        if (existingRecord && existingRecord.Status !== "CANCELED") {
            throw new AppError("已經報名過囉", 400);
        }

        const resCount = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED", IsVirtual: false })
            .sum({ total: trx.raw('1 + COALESCE("FriendCount", 0)') })
            .first();

        const confirmedCount = Number(resCount.total || 0);
        const maxPlayers = Number(game.MaxPlayers);

        let status = "CONFIRMED";
        let waitlistOrder = null;

        if (confirmedCount + totalToJoin > maxPlayers) {
            status = "WAITLIST";
            const waitResult = await trx("GamePlayers")
                .where({ GameId: gameId, Status: "WAITLIST", IsVirtual: false })
                .count("* as count")
                .first();
            waitlistOrder = Number(waitResult.count) + 1;
        }

        const commonPayload = {
            Status: status,
            PhoneNumber: phone,
            JoinedAt: trx.fn.now(),
            CanceledAt: null,
            status: "waiting_checkin",
            check_in_at: null
        };

        if (existingRecord) {
            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId, IsVirtual: false })
                .update({ ...commonPayload, FriendCount: friendCount });
        } else {
            await trx("GamePlayers").insert({
                GameId: gameId, UserId: userId, IsVirtual: false,
                FriendCount: friendCount, ...commonPayload
            });
        }

        const existingVirtual = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId, IsVirtual: true })
            .first();

        if (friendCount > 0) {
            if (existingVirtual) {
                await trx("GamePlayers")
                    .where({ GameId: gameId, UserId: userId, IsVirtual: true })
                    .update({ ...commonPayload, FriendCount: 0 });
            } else {
                await trx("GamePlayers").insert({
                    GameId: gameId, UserId: userId, IsVirtual: true,
                    FriendCount: 0, ...commonPayload
                });
            }
        } else {
            if (existingVirtual) {
                await trx("GamePlayers")
                    .where({ GameId: gameId, UserId: userId, IsVirtual: true })
                    .update({ Status: "CANCELED", CanceledAt: trx.fn.now() });
            }
        }

        const finalCountRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED" })
            .count("* as total")

        const finalTotal = Number(finalCountRes.total || 0);
        await trx("Games").where({ GameId: gameId }).update({ CurrentPlayers: finalTotal });

        return { finalTotal, status, waitlistOrder };
    });

    res.status(201).json({
        success: true,
        message: result.status === "CONFIRMED" ? "報名成功" : `候補第 ${result.waitlistOrder} 位`,
        currentPlayers: result.finalTotal,
    });
};

const getJoinedGames = async (req, res) => {
    const userId = req.user.id;

    const joinedGames = await knex("GamePlayers")
        .join("Games", "GamePlayers.GameId", "Games.GameId")
        .where("GamePlayers.UserId", userId)
        .where("GamePlayers.IsVirtual", false)
        .whereNot("GamePlayers.Status", "CANCELED")
        .whereIn("GamePlayers.Status", ["CONFIRMED", "WAITLIST"])
        .select(
            "Games.GameId",
            "Games.Title",
            "Games.GameDateTime",
            locationSelect,
            "Games.EndTime",
            "Games.Price",
            "Games.MaxPlayers",
            knex.ref("GamePlayers.Status").as("MyStatus"),
            "GamePlayers.JoinedAt",
            "GamePlayers.FriendCount",
            "Games.Notes",
            knex.ref("Games.CanceledAt").as("GameCanceledAt"),
            currentPlayersSubquery(),
            totalCountSubquery(),
            "Games.HostContact",
            'GamePlayers.status',
            'GamePlayers.check_in_at',

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

    const result = await knex.transaction(async (trx) => {
        const player = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId, IsVirtual: false })
            .first();
        const game = await trx("Games").where({ GameId: gameId }).forUpdate().first();

        if (!player || player.Status === "CANCELED") throw new Error("找不到報名紀錄");
        if (player.status !== 'waiting_checkin') {
            throw new AppError("您已簽到或在場上，無法自行取消。如需取消請聯繫主揪。", 400);
        }

        let message = "";

        if (cancelType === 'friend_only' && player.FriendCount > 0) {

            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId, IsVirtual: false })
                .update({ FriendCount: 0 });

            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId, IsVirtual: true })
                .update({
                    Status: "CANCELED",
                    CanceledAt: trx.fn.now(),
                    status: "waiting_checkin",
                    check_in_at: null
                });

            message = "已取消朋友報名，保留本人名額";
        } else {
            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId })
                .update({
                    Status: "CANCELED",
                    CanceledAt: trx.fn.now(),
                    FriendCount: 0,
                    status: "waiting_checkin",
                    check_in_at: null
                });
            message = "已成功取消報名";
        }

        let promotedCount = 0;
        while (true) {
            const confRes = await trx("GamePlayers")
                .where({ GameId: gameId, Status: "CONFIRMED", IsVirtual: false })
                .sum({ total: trx.raw('1 + COALESCE("FriendCount", 0)') })
                .first();

            const currentTotal = Number(confRes.total || 0);
            const space = game.MaxPlayers - currentTotal;
            if (space <= 0) break;

            const nextWait = await trx("GamePlayers")
                .where({ GameId: gameId, Status: "WAITLIST", IsVirtual: false })
                .orderBy("JoinedAt", "asc")
                .first();

            if (!nextWait) break;

            const nextSize = 1 + (nextWait.FriendCount || 0);
            if (nextSize <= space) {
                await trx("GamePlayers")
                    .where({ GameId: gameId, UserId: nextWait.UserId })
                    .whereNot("Status", "CANCELED")
                    .update({ Status: "CONFIRMED", PromotedAt: trx.fn.now() });
                promotedCount++;
            } else {
                break;
            }
        }

        const finalTotalRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED", IsVirtual: false })
            .sum({ total: trx.raw('1 + COALESCE("FriendCount", 0)') })
            .first();
        const finalTotal = Number(finalTotalRes.total || 0);
        await trx("Games").where({ GameId: gameId }).update({ CurrentPlayers: finalTotal });

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
            "GamePlayers.IsVirtual",
            "GamePlayers.FriendCount"
        )
        .where("GamePlayers.GameId", gameId)
        .whereNull("GamePlayers.CanceledAt")
        .whereNot("GamePlayers.Status", "CANCELED")
        .orderBy("GamePlayers.JoinedAt", "asc");

    const formattedData = players.map(p => ({
        Username: p.IsVirtual ? `${p.Username} +1` : p.Username,
        Status: p.Status
    }));

    res.json({
        success: true,
        data: formattedData,
        count: formattedData.length
    });
};
const addFriend = async (req, res) => {
    const gameId = parseInt(req.params.id);
    const userId = req.user?.id;

    console.log("--- 進入 addFriend 流程 ---");
    console.log(`GameId: ${gameId}, UserId: ${userId}`);

    const result = await knex.transaction(async (trx) => {
        const player = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId, IsVirtual: false })
            .forUpdate()
            .first();

        let initialStatus = "waiting_checkin";
        let initialCheckInAt = null;

        if (player.status !== "waiting_checkin") {
            initialStatus = "idle";
            initialCheckInAt = player.check_in_at || trx.fn.now();
        }

        const virtualPayload = {
            Status: player.Status,
            PhoneNumber: player.PhoneNumber,
            FriendCount: 0,
            IsVirtual: true,
            JoinedAt: trx.fn.now(),
            status: initialStatus,
            check_in_at: initialCheckInAt,
            CanceledAt: null
        };

        const existingVirtual = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId, IsVirtual: true })
            .first();

        if (existingVirtual) {
            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId, IsVirtual: true })
                .update(virtualPayload);
        } else {
            await trx("GamePlayers").insert({
                GameId: gameId,
                UserId: userId,
                ...virtualPayload
            });
        }

        const confRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED", IsVirtual: false })
            .sum({ total: trx.raw('1 + "FriendCount"') })
            .first();

        const currentConfirmedTotal = Number(confRes.total || 0);
        const game = await trx("Games").where({ GameId: gameId }).forUpdate().first();

        if (player.Status === "CONFIRMED" && currentConfirmedTotal > game.MaxPlayers) {
            console.log(`[DEBUG] 人數爆滿，將使用者 ${userId} 及其朋友轉為 WAITLIST`);
            await trx("GamePlayers")
                .where({ GameId: gameId, UserId: userId })
                .update({ Status: "WAITLIST" });
        }

        const finalTotal = currentConfirmedTotal;
        await trx("Games").where({ GameId: gameId }).update({ CurrentPlayers: finalTotal });

        return { finalTotal };
    });

    res.status(200).json({
        success: true,
        message: "已成功為朋友 +1 位",
        currentPlayers: result.finalTotal
    });
};

const getGameById = async (req, res) => {
    const { id } = req.params;

    try {
        const game = await knex("Games")
            .where("GameId", id)
            .select(
                "GameId",
                "Title",
                "GameDateTime",
                "Location",
                "EndTime",
                "Price",
                "MaxPlayers",
                "Notes",
                "CourtCount",  // 這很重要，Live 看板用來決定開幾個場
                "CourtNumber",
                "HostContact"
            )
            .first();

        if (!game) {
            return res.status(404).json({ success: false, message: "找不到該球局" });
        }

        res.json({
            success: true,
            data: game
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
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
    addFriend,
    getGameById
};
