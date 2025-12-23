const knex = require('../db');
const validator = require('validator');
const AppError = require('../utils/appError');
const createGame = async (req, res) => {
    const userId = req.user.id;
    const { title, gameDate, gameTime, endTime, location, maxPlayers, price } = req.body;
    // console.log(req.body)
    const gameDateTime = `${gameDate} ${gameTime}`;


    if (!title) throw new AppError('缺少名稱', 400);
    if (!gameDate) throw new AppError('缺少日期', 400);
    if (!validator.isDate(gameDate, { format: 'YYYY-MM-DD', strictMode: true })) {
        throw new AppError('日期格式錯誤，請使用 YYYY-MM-DD 格式', 400);
    }
    if (!maxPlayers) throw new AppError('缺少人數上限', 400);
    if (!gameTime) throw new AppError('缺少開始時間', 400);
    if (!validator.isTime(gameTime, { hourFormat: 'hour24' })) {
        throw new AppError('時間格式錯誤，請使用24小時制 hh:mm 格式', 400);
    }
    if (!endTime) throw new AppError('缺少結束時間', 400);
    if (!validator.isTime(endTime, { hourFormat: 'hour24' })) {
        throw new AppError('時間格式錯誤，請使用24小時制 hh:mm 格式', 400);
    }
    if (endTime <= gameTime) {
        throw new AppError('結束時間必須晚於開始時間', 400);
    }

    const existingGame = await knex('Games')
        .where({
            HostID: userId,
            GameDateTime: gameDateTime,
            Location: location,
            IsActive: true
        })
        .first();
    if (existingGame) {
        throw new AppError('已有同時段同地點團囉！請勿重複建立。', 400);
    }
    const newGame = await knex.transaction(async (trx) => {
        const [insertedGame] = await trx('Games')
            .insert({
                Title: title,
                GameDateTime: gameDateTime,
                EndTime: endTime,
                Location: location,
                MaxPlayers: Number(maxPlayers),
                Price: Number(price),
                HostID: userId,
                IsActive: true,
            })
            .returning('*');

        await trx('GamePlayers')
            .insert({
                GameId: insertedGame.GameId,
                UserId: userId,
                Status: 'CONFIRMED',
                JoinedAt: knex.fn.now(),
            });

        return insertedGame;
    });
    res.status(201).json({
        success: true,
        message: '開團成功',
        game: newGame,
    });
};
const getGame = async (req, res) => {
    const userId = req.user.id;
    const activeGames = await knex('Games')
        .whereNull('CanceledAt')
        .where({
            HostId: userId,
            IsActive: true
        })
        .select(
            'Games.GameId',
            'Games.Title',
            'Games.GameDateTime',
            'Games.Location',
            'Games.EndTime',
            'Games.Price',
            'Games.MaxPlayers',
            'Games.HostID',
            knex.raw(`(
                    SELECT COUNT(*) 
                    FROM GamePlayers as gp 
                    WHERE gp.GameId = Games.GameId 
                    AND gp.Status = 'CONFIRMED'
                ) as CurrentPlayers`)

        )
        .orderBy('Games.GameDateTime', 'desc');

    res.status(200).json({
        success: true,
        data: activeGames
    });
}
const getAllGames = async (req, res, next) => {
    const activeGames = await knex('Games')
        .join('Users', 'Games.HostID', '=', 'Users.Id')
        .whereNull('CanceledAt')
        .select(
            'Games.GameId',
            'Games.Title',
            'Games.GameDateTime',
            'Games.Location',
            'Games.EndTime',
            'Games.Price',
            'Games.MaxPlayers',
            'Users.username as hostName',
            knex.raw(`(
                    SELECT COUNT(*) 
                    FROM GamePlayers as gp 
                    WHERE gp.GameId = Games.GameId 
                    AND gp.Status = 'CONFIRMED'
                ) as CurrentPlayers`)

        )
        .orderBy('Games.GameDateTime', 'desc'); // 依球局時間排序

    res.status(200).json({
        success: true,
        data: activeGames
    });
}


const deleteGame = async (req, res) => {
    const gameId = req.params.id;
    const userId = req.user.id;
    if (!gameId) {
        console.warn('缺少球團名稱');
        return res.status(400).json({
            success: false,
            message: '缺少球團名稱'
        })
    }
    const game = await knex('Games').where({ GameId: gameId }).first();
    if (!game) {
        throw new AppError('找不到此球團');
    }

    if (String(game.HostID) !== String(userId)) {
        return res.status(403).json({ success: false, message: '權限不足，只有團主可以取消此團' });
    }

    if (!game.IsActive || game.CanceledAt) {
        throw new AppError('此團已經取消過了');
    }
    if (!userId) {
        console.warn('缺少開團人');
        return res.status(400).json({
            success: false,
            message: '缺少開團人'
        })
    }
    const [updatedGame] = await knex('Games')
        .where({ GameId: gameId })
        .update({
            IsActive: false,
            CanceledAt: knex.fn.now()
        })
        .returning('*');
    res.status(201).json({
        success: true,
        message: '取消成功',
        game: updatedGame
    });

}
const joinGame = async (req, res, next) => {
    const gameId = req.params.id;
    const userId = req.user.id;
    const phone = req.body.phone;

    // 1. 開啟事務 (Transaction)
    const trx = await knex.transaction();

    try {
        // 先檢查球團是否存在
        const game = await trx('Games').where({ GameId: gameId }).first();
        if (!game) {
            throw new AppError('沒有此球團', 404);
        }
        if (!game.IsActive || game.CanceledAt) {
            throw new AppError('此團已被取消', 400);
        }
        if (!phone) {
            throw new AppError('缺少電話', 400);
        }

        // 2. 檢查是否已經有紀錄 (包含已取消的)
        const existingRecord = await trx('GamePlayers')
            .where({ GameId: gameId, UserId: userId })
            .first();

        // 3. 如果有紀錄，且狀態不是 CANCELED，代表重複報名
        if (existingRecord && existingRecord.Status !== 'CANCELED') {
            throw new AppError('已經報名過囉', 400);
        }

        // 4. 計算目前正取人數
        const [{ count }] = await trx('GamePlayers')
            .where({ GameId: gameId, Status: 'CONFIRMED' })
            .count('* as count');

        const confirmedCount = Number(count);
        const maxPlayers = game.MaxPlayers;

        let status = 'CONFIRMED';
        let waitlistOrder = null;

        // 如果人數已滿，轉為候補
        if (confirmedCount >= maxPlayers) {
            status = 'WAITLIST';

            const [{ waitCount }] = await trx('GamePlayers')
                .where({ GameId: gameId, Status: 'WAITLIST' })
                .count('* as waitCount');

            waitlistOrder = Number(waitCount) + 1;
        }

        let result;

        // 5. 執行 插入 或 更新
        if (existingRecord) {
            [result] = await trx('GamePlayers')
                .where({ GameId: gameId, UserId: userId })
                .update({
                    Status: status,           // 改回正取或候補
                    PhoneNumber: phone,       // 更新電話
                    JoinedAt: knex.fn.now(),  // 更新報名時間 (視為重新排隊)
                    CanceledAt: null          // 清除取消時間
                })
                .returning('*');
        } else {
            [result] = await trx('GamePlayers')
                .insert({
                    GameId: gameId,
                    UserId: userId,
                    PhoneNumber: phone,
                    Status: status,
                    JoinedAt: knex.fn.now(),
                })
                .returning('*');
        }

        // 6. 重新計算並更新 Games 表中的 CurrentPlayers
        const [{ finalCount }] = await trx('GamePlayers')
            .where({ GameId: gameId, Status: 'CONFIRMED' })
            .count('* as finalCount');

        await trx('Games')
            .where({ GameId: gameId })
            .update({
                CurrentPlayers: Number(finalCount)
            });

        // 7. 提交事務
        await trx.commit();

        res.status(201).json({
            success: true,
            message: status === 'CONFIRMED'
                ? '報名成功'
                : `名額已滿，你目前是候補第 ${waitlistOrder} 位`,
            game: result,
            currentPlayers: Number(finalCount)
        });

    } catch (error) {
        // 如果中間有任何錯誤，回滾事務，確保資料一致性
        await trx.rollback();
        next(error); // 交給後續的 Error Handler 處理
    }
}
const getJoinedGames = async (req, res, next) => {
    const userId = req.user.id;

    const joinedGames = await knex('GamePlayers')
        .join('Games', 'GamePlayers.GameId', 'Games.GameId') // 連接 Games 表取得球局資訊
        .where('GamePlayers.UserId', userId)                 // 找出我的紀錄
        .whereIn('GamePlayers.Status', ['CONFIRMED', 'WAITLIST']) // 只抓 正取 或 候補 (排除已取消)
        .select(
            'Games.GameId',
            'Games.Title',
            'Games.GameDateTime',
            'Games.Location',
            'Games.EndTime',
            'Games.Price',
            'Games.MaxPlayers',
            'GamePlayers.Status as MyStatus', // 讓前端知道我是正取還是候補
            'GamePlayers.JoinedAt',
            knex.raw(`(
                    SELECT COUNT(*) 
                    FROM GamePlayers as gp 
                    WHERE gp.GameId = Games.GameId 
                    AND gp.Status = 'CONFIRMED'
                ) as CurrentPlayers`)

        )
        .orderBy('Games.GameDateTime', 'desc'); // 依球局時間排序

    res.status(200).json({
        success: true,
        data: joinedGames
    });
};

const cancelJoin = async (req, res, next) => {
    const gameId = req.params.id;
    const userId = req.user.id;

    const promoted = await knex.transaction(async (trx) => {

        const player = await trx('GamePlayers')
            .where({ GameId: gameId, UserId: userId })
            .whereNot('Status', 'CANCELED')
            .first();

        if (!player) {
            throw new AppError('找不到報名紀錄或已取消');
        }

        const wasConfirmed = player.Status === 'CONFIRMED';

        await trx('GamePlayers')
            .where({ GameId: gameId, UserId: userId })
            .update({
                Status: 'CANCELED',
                CanceledAt: knex.fn.now(),
            });

        if (!wasConfirmed) return null;

        const nextWait = await trx('GamePlayers')
            .where({ GameId: gameId, Status: 'WAITLIST' })
            .orderBy('JoinedAt', 'asc')
            .first();

        if (!nextWait) return null;

        await trx('GamePlayers')
            .where({ GameId: gameId, UserId: nextWait.UserId })
            .update({
                Status: 'CONFIRMED',
                PromotedAt: knex.fn.now(),
            });

        return {
            userId: nextWait.UserId,
            from: 'WAITLIST',
            to: 'CONFIRMED',
        };
    });

    res.status(200).json({
        success: true,
        message: promoted
            ? '取消成功，已自動遞補 1 位候補'
            : '取消成功',
        promoted,
    });
};

const playerList = async (req, res) => {
    // 從 URL 參數取得 GameId，並確保它是數字
    const gameId = req.params.id;

    if (!gameId) {
        return res.status(400).json({ success: false, message: '缺少球局 ID' });
    }


    const players = await knex('GamePlayers')
        // 1. Join 使用者資料表，取得報名人的名字
        // 請確認你的 Users 表主鍵是 'Id'，名字欄位是 'Username'
        .join('Users', 'GamePlayers.UserId', '=', 'Users.Id')
        .select(
            'Users.Username',      // 前端顯示的名字
            'GamePlayers.Status',   // 狀態 (CONFIRMED / WAITLIST)
            'GamePlayers.JoinedAt'  // 報名時間 (選填)
        )
        .where('GamePlayers.GameId', gameId)
        // 2. 排除已經取消報名的人
        .whereNull('GamePlayers.CanceledAt')
        // 3. 按照報名時間排序 (先報名的排前面)
        .orderBy('GamePlayers.JoinedAt', 'asc');

    // 回傳資料
    res.json({
        success: true,
        data: players,
        // 額外回傳總人數，前端可以選擇性使用
        count: players.length
    });
};




module.exports = { createGame, getGame, getAllGames, deleteGame, joinGame, getJoinedGames, cancelJoin, playerList };
