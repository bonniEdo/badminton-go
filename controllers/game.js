const knex = require("../db");
const validator = require("validator");
const AppError = require("../utils/appError");
const { GameStatus } = require('../utils/gameHelpers');
const { broadcastToGame } = require('../wsServer');

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

const FRIEND_GENDERS = ['male', 'female', 'undisclosed'];
const normalizeFriendGender = (rawGender) => {
    const normalized = String(rawGender || '').trim().toLowerCase();
    return FRIEND_GENDERS.includes(normalized) ? normalized : 'undisclosed';
};


const createGame = async (req, res) => {
    const userId = req.user.id;
    const {
        title, gameDate, gameTime, endTime, location,
        courtNumber, courtCount,
        maxPlayers, price, notes, phone
    } = req.body;

    const trimmedLocation = location ? location.trim() : "";

    const gameDateTime = `${gameDate} ${gameTime}`;
    const existingGame = await knex("Games")
        .where({
            HostID: userId,
            GameDateTime: gameDateTime,
            Location: trimmedLocation, // 使用去空白後的地址
            CourtNumber: courtNumber || null,
            IsActive: true,
        })
        .whereNull("DeletedAt")
        .first();

    if (existingGame) {
        // 如果你希望更寬鬆，這裡可以移除這項檢查，或保留
        throw new AppError("已有同時段同場所的療程囉！", 400);
    }

    const newGame = await knex.transaction(async (trx) => {
        const [insertedGame] = await trx("Games")
            .insert({
                Title: title,
                GameDateTime: gameDateTime,
                EndTime: endTime,
                Location: trimmedLocation, // 存入資料庫
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
            IsVirtual: false,
            JoinedAt: knex.fn.now(),
        });

        return insertedGame;
    });

    res.status(201).json({ success: true, message: "開診成功", game: newGame });
};

const updateGame = async (req, res) => {
    const gameId = Number(req.params.id);
    const userId = req.user.id;
    const {
        title, gameDate, gameTime, endTime, location,
        courtNumber, courtCount,
        maxPlayers, price, notes, phone
    } = req.body;

    if (!gameId) throw new AppError("缺少療程編號", 400);

    const game = await knex("Games").where({ GameId: gameId }).whereNull("DeletedAt").first();
    if (!game) throw new AppError("找不到此療程", 404);
    if (String(game.HostID) !== String(userId)) throw new AppError("權限不足，只有主治可以編輯療程", 403);
    if (!game.IsActive || game.CanceledAt) throw new AppError("此療程已終止，無法編輯", 400);

    const nextMaxPlayers = Number(maxPlayers);
    if (!Number.isFinite(nextMaxPlayers) || nextMaxPlayers <= 0) {
        throw new AppError("人數上限格式錯誤", 400);
    }

    const confirmedRes = await knex("GamePlayers")
        .where({ GameId: gameId, Status: "CONFIRMED", IsVirtual: false })
        .sum({ total: knex.raw('1 + COALESCE("FriendCount", 0)') })
        .first();
    const confirmedCount = Number(confirmedRes?.total || 0);
    if (nextMaxPlayers < confirmedCount) {
        throw new AppError(`人數上限不可低於目前已確認人數（${confirmedCount}）`, 400);
    }

    const trimmedLocation = location ? location.trim() : "";
    const gameDateTime = `${gameDate} ${gameTime}`;

    const existingGame = await knex("Games")
        .where({
            HostID: userId,
            GameDateTime: gameDateTime,
            Location: trimmedLocation,
            CourtNumber: courtNumber || null,
            IsActive: true,
        })
        .whereNull("DeletedAt")
        .whereNot({ GameId: gameId })
        .first();

    if (existingGame) {
        throw new AppError("已有同時段同場所的療程囉！", 400);
    }

    const [updatedGame] = await knex("Games")
        .where({ GameId: gameId })
        .update({
            Title: title,
            GameDateTime: gameDateTime,
            EndTime: endTime,
            Location: trimmedLocation,
            CourtNumber: courtNumber || null,
            CourtCount: Number(courtCount) || 1,
            MaxPlayers: nextMaxPlayers,
            Price: Number(price),
            Notes: notes,
            HostContact: phone,
        })
        .returning("*");

    res.status(200).json({ success: true, message: "療程更新成功", game: updatedGame });
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

const buildAvatarListUrl = (req, userId, avatarUrl) => {
    if (!avatarUrl || typeof avatarUrl !== "string") return null;
    if (!avatarUrl.startsWith("data:image/")) return avatarUrl;
    if (!userId) return null;
    const origin = `${req.protocol}://${req.get('host')}`;
    return `${origin}/api/user/avatar/${userId}`;
};

const getGame = async (req, res) => {
    const userId = req.user.id;


    const activeGames = await knex("Games")
        .leftJoin({ gpSelf: "GamePlayers" }, function () {
            this.on("gpSelf.GameId", "=", "Games.GameId")
                .andOn("gpSelf.UserId", "=", "Games.HostID")
                .andOn(knex.raw('"gpSelf"."IsVirtual" = false'))
                .andOn(knex.raw('"gpSelf"."Status" != ?', ["CANCELED"]));
        })
        .where({
            HostID: userId,
        })
        .whereNull("Games.DeletedAt")
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
            knex.ref("gpSelf.status").as("status"),
            knex.ref("gpSelf.check_in_at").as("check_in_at"),
            currentPlayersSubquery(),
            totalCountSubquery()
        )
        .orderBy("Games.GameDateTime", "desc");

    const processedGames = GameStatus(activeGames);
    const sortedGames = processedGames
        .sort((a, b) => a.isExpired - b.isExpired)
        .map((g) => ({
            ...g,
            hostAvatarUrl: buildAvatarListUrl(req, g.HostID, g.hostAvatarUrl)
        }));

    res.status(200).json({
        success: true,
        data: sortedGames,
    });
};

const getAllGames = async (req, res) => {
    const userId = req.user?.id || null;
    const activeGames = await knex("Games")
        .join("Users", "Games.HostID", "Users.Id")
        .where("IsActive", true)
        .whereNull("Games.CanceledAt")
        .whereNull("Games.DeletedAt")
        .select(
            "Games.GameId",
            "Games.Title",
            "Games.GameDateTime",
            locationSelect,
            "Games.EndTime",
            "Games.Price",
            "Games.MaxPlayers",
            "Games.Notes",
            "Games.HostID",
            "Games.HostContact",
            knex.raw(
                `(SELECT COALESCE(MAX("FriendCount"), 0) FROM "GamePlayers" 
                  WHERE "GamePlayers"."GameId" = "Games"."GameId" 
                  AND "GamePlayers"."UserId" = ? 
                  AND COALESCE("GamePlayers"."IsVirtual", false) = false
                  AND "GamePlayers"."CanceledAt" IS NULL
                  AND "GamePlayers"."Status" != 'CANCELED' 
                ) as "MyFriendCount"`,
                [userId]
            ),

            knex.ref("Users.Username").as("hostName"), // ✅ 這裡改 Username（大寫U）
            knex.ref("Users.AvatarUrl").as("hostAvatarUrl"),
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

const closeGame = async (req, res) => {
    const gameId = req.params.id;
    const userId = req.user.id;

    if (!gameId) {
        return res.status(400).json({ success: false, message: "缺少療程名稱" });
    }

    const game = await knex("Games").where({ GameId: gameId }).whereNull("DeletedAt").first();
    if (!game) throw new AppError("找不到此療程", 404);

    if (String(game.HostID) !== String(userId)) {
        return res.status(403).json({ success: false, message: "權限不足，只有主治可以終止此療程" });
    }

    if (!game.IsActive || game.CanceledAt) {
        throw new AppError("此療程已經終止過了", 400);
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

const deleteGame = async (req, res) => {
    const gameId = req.params.id;
    const userId = req.user.id;

    if (!gameId) {
        return res.status(400).json({ success: false, message: "Missing game id" });
    }

    const game = await knex("Games").where({ GameId: gameId }).whereNull("DeletedAt").first();
    if (!game) throw new AppError("Game not found", 404);

    if (String(game.HostID) !== String(userId)) {
        return res.status(403).json({ success: false, message: "Only host can delete this game" });
    }

    await knex.transaction(async (trx) => {
        await trx("GamePlayers")
            .where({ GameId: gameId })
            .whereNot("Status", "CANCELED")
            .update({
                Status: "CANCELED",
                CanceledAt: trx.fn.now(),
            });

        await trx("Games")
            .where({ GameId: gameId })
            .update({
                IsActive: false,
                CanceledAt: trx.raw('COALESCE("CanceledAt", NOW())'),
                DeletedAt: trx.fn.now(),
            });
    });

    res.status(200).json({
        success: true,
        message: "Game deleted",
    });
};

const joinGame = async (req, res) => {
    const gameId = req.params.id;
    const userId = req.user.id;
    const { phone, numPlayers, friendLevel } = req.body;
    const friendGender = normalizeFriendGender(req.body?.friendGender);
    const requestedPlayers = Number(numPlayers || 1);
    if (![1, 2].includes(requestedPlayers)) {
        throw new AppError("報名人數僅限 1 或 2 位", 400);
    }
    const normalizedPhone = String(phone || "").replace(/\D/g, "");
    if (!/^09\d{8}$/.test(normalizedPhone)) {
        throw new AppError("電話格式需為 09 開頭的 10 碼", 400);
    }
    const friendCount = requestedPlayers === 2 ? 1 : 0;
    const totalToJoin = 1 + friendCount;

    const result = await knex.transaction(async (trx) => {
        const game = await trx("Games").where({ GameId: gameId }).whereNull("DeletedAt").forUpdate().first();
        if (!game) throw new AppError("沒有此療程", 404);
        if (!game.IsActive || game.CanceledAt) throw new AppError("此療程已被終止", 400);

        const existingRecord = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId, IsVirtual: false })
            .first();

        if (existingRecord && existingRecord.Status !== "CANCELED") {
            throw new AppError("已經掛號過囉", 400);
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
            PhoneNumber: normalizedPhone,
            JoinedAt: trx.fn.now(),
            CanceledAt: null,
            status: "waiting_checkin",
            check_in_at: null
        };

        // 1. 處理本人紀錄 (IsVirtual: false)
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
            const virtualData = {
                ...commonPayload,
                FriendCount: 0,
                IsVirtual: true,
                FriendLevel: friendLevel,
                FriendGender: friendGender
            };

            if (existingVirtual) {
                await trx("GamePlayers")
                    .where({ GameId: gameId, UserId: userId, IsVirtual: true })
                    .update(virtualData);
            } else {
                await trx("GamePlayers").insert({
                    GameId: gameId, UserId: userId, ...virtualData
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
            .first();

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
        .where("Games.IsActive", true)
        .whereNull("Games.CanceledAt")
        .whereNull("Games.DeletedAt")
        .where(function () {
            this.where("GamePlayers.IsVirtual", false).orWhereNull("GamePlayers.IsVirtual");
        })
        .whereNot("GamePlayers.Status", "CANCELED")
        .whereIn("GamePlayers.Status", ["CONFIRMED", "WAITLIST"])
        .whereNot("Games.HostID", userId)
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
        const game = await trx("Games").where({ GameId: gameId }).whereNull("DeletedAt").forUpdate().first();

        if (!player || player.Status === "CANCELED") throw new Error("找不到掛號紀錄");
        if (!game) throw new AppError("Game not found", 404);
        if (player.status !== 'waiting_checkin') {
            throw new AppError("您已報到或在場上，無法自行取消。如需取消請聯繫主治。", 400);
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

            message = "已取消同伴掛號，保留本人名額";
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
            message = "已成功取消掛號";
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
    const game = await knex("Games").where({ GameId: gameId }).whereNull("DeletedAt").first();
    if (!game) {
        return res.status(404).json({ success: false, message: "Game not found" });
    }

    const players = await knex("GamePlayers")
        .join("Users", "GamePlayers.UserId", "Users.Id")
        .select(
            "GamePlayers.UserId",
            "Users.Username",
            "Users.AvatarUrl",
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
        Status: p.Status,
        UserId: p.IsVirtual ? null : p.UserId,
        IsVirtual: !!p.IsVirtual,
        AvatarUrl: buildAvatarListUrl(req, p.UserId, p.AvatarUrl)
    }));

    res.json({
        success: true,
        data: formattedData,
        count: formattedData.length
    });
};
const addFriend = async (req, res) => {
    const gameId = Number(req.params.id);
    const userId = req.user?.id;
    const { friendLevel } = req.body;
    const friendGender = normalizeFriendGender(req.body?.friendGender);
    if (!Number.isInteger(gameId) || gameId <= 0) {
        throw new AppError("缺少療程編號", 400);
    }

    const result = await knex.transaction(async (trx) => {
        const player = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId, IsVirtual: false })
            .forUpdate()
            .first();

        if (!player) throw new Error("找不到您的掛號紀錄");
        if (player.Status === "CANCELED") throw new AppError("找不到您的掛號紀錄", 404);
        if (Number(player.FriendCount || 0) >= 1) {
            throw new AppError("每位會員最多幫一人報名", 400);
        }

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
            FriendLevel: friendLevel,
            FriendGender: friendGender,
            JoinedAt: trx.fn.now(),
            status: initialStatus,
            check_in_at: initialCheckInAt,
        };

        const existingVirtual = await trx("GamePlayers")
            .where({ GameId: gameId, UserId: userId, IsVirtual: true })
            .first();

        if (existingVirtual && existingVirtual.Status !== "CANCELED") {
            throw new AppError("每位會員最多幫一人報名", 400);
        }

        if (existingVirtual) {
            await trx("GamePlayers")
                .where({ Id: existingVirtual.Id })
                .update(virtualPayload);
        } else {
            await trx("GamePlayers").insert({
                GameId: gameId,
                UserId: userId,
                ...virtualPayload
            });
        }

        await trx("GamePlayers")
            .where({ Id: player.Id })
            .update({ FriendCount: 1 });

        const confRes = await trx("GamePlayers")
            .where({ GameId: gameId, Status: "CONFIRMED", IsVirtual: false })
            .sum({ total: trx.raw('1 + "FriendCount"') })
            .first();

        const currentConfirmedTotal = Number(confRes.total || 0);
        const game = await trx("Games").where({ GameId: gameId }).whereNull("DeletedAt").forUpdate().first();
        if (!game) throw new AppError("Game not found", 404);

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
        message: "報名成功",
        currentPlayers: result.finalTotal
    });
};

const getGameById = async (req, res) => {
    const { id } = req.params;

    try {
        const game = await knex("Games")
            .where("GameId", id)
            .whereNull("DeletedAt")
            .select(
                "GameId",
                "Title",
                "GameDateTime",
                "Location",
                "EndTime",
                "Price",
                "MaxPlayers",
                "Notes",
                "CourtCount",
                "CourtNumber",
                "HostContact"
            )
            .first();

        if (!game) {
            return res.status(404).json({ success: false, message: "找不到該療程" });
        }

        res.json({
            success: true,
            data: game
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const markPaid = async (req, res) => {
    const gameId = parseInt(req.params.id);
    const userId = req.user?.id;
    const { playerId } = req.body;

    try {
        const game = await knex("Games").where({ GameId: gameId, HostID: userId }).whereNull("DeletedAt").first();
        if (!game) return res.status(403).json({ success: false, message: "僅主治可操作" });

        const player = await knex("GamePlayers").where({ Id: playerId, GameId: gameId }).first();
        if (!player) return res.status(404).json({ success: false, message: "找不到該掛號者" });

        const newPaidAt = player.paid_at ? null : knex.fn.now();
        const updateFields = { paid_at: newPaidAt };

        let checkedIn = false;
        if (!player.paid_at && player.status === 'waiting_checkin') {
            await knex("GamePlayers")
                .where({ GameId: gameId, UserId: player.UserId, status: 'waiting_checkin' })
                .whereNot('Status', 'CANCELED')
                .update({ status: 'idle', check_in_at: knex.fn.now() });
            checkedIn = true;
        }

        await knex("GamePlayers").where({ Id: playerId }).update(updateFields);

        broadcastToGame(gameId);
        res.json({ success: true, paid: !player.paid_at, checkedIn });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createGame,
    updateGame,
    getGame,
    getAllGames,
    closeGame,
    deleteGame,
    joinGame,
    getJoinedGames,
    cancelJoin,
    playerList,
    addFriend,
    getGameById,
    markPaid
};
