const knex = require('../db');
const validator = require('validator');
const AppError = require('../utils/appError');
const createGame = async (req, res) => {
    const userId = req.user.id;
    const { title, gameDate, gameTime, endTime, location, maxPlayers, price, notes } = req.body;
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
                Notes: notes,
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
            'Games.Notes',
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
            'Games.Notes',
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

    const trx = await knex.transaction();

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
    const existingRecord = await trx('GamePlayers')
        .where({ GameId: gameId, UserId: userId })
        .first();
    if (existingRecord && existingRecord.Status !== 'CANCELED') {
        throw new AppError('已經報名過囉', 400);
    }
    const [{ count }] = await trx('GamePlayers')
        .where({ GameId: gameId, Status: 'CONFIRMED' })
        .count('* as count');

    const confirmedCount = Number(count);
    const maxPlayers = game.MaxPlayers;

    let status = 'CONFIRMED';
    let waitlistOrder = null;

    if (confirmedCount >= maxPlayers) {
        status = 'WAITLIST';

        const [{ waitCount }] = await trx('GamePlayers')
            .where({ GameId: gameId, Status: 'WAITLIST' })
            .count('* as waitCount');

        waitlistOrder = Number(waitCount) + 1;
    }

    let result;

    if (existingRecord) {
        [result] = await trx('GamePlayers')
            .where({ GameId: gameId, UserId: userId })
            .update({
                Status: status,
                PhoneNumber: phone,
                JoinedAt: knex.fn.now(),
                CanceledAt: null
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

    const [{ finalCount }] = await trx('GamePlayers')
        .where({ GameId: gameId, Status: 'CONFIRMED' })
        .count('* as finalCount');

    await trx('Games')
        .where({ GameId: gameId })
        .update({
            CurrentPlayers: Number(finalCount)
        });

    await trx.commit();

    res.status(201).json({
        success: true,
        message: status === 'CONFIRMED'
            ? '報名成功'
            : `名額已滿，你目前是候補第 ${waitlistOrder} 位`,
        game: result,
        currentPlayers: Number(finalCount)
    });
}
const getJoinedGames = async (req, res, next) => {
    const userId = req.user.id;

    const joinedGames = await knex('GamePlayers')
        .join('Games', 'GamePlayers.GameId', 'Games.GameId')
        .where('GamePlayers.UserId', userId)
        .whereIn('GamePlayers.Status', ['CONFIRMED', 'WAITLIST'])
        .select(
            'Games.GameId',
            'Games.Title',
            'Games.GameDateTime',
            'Games.Location',
            'Games.EndTime',
            'Games.Price',
            'Games.MaxPlayers',
            'GamePlayers.Status as MyStatus',
            'GamePlayers.JoinedAt',
            'Games.Notes',
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
    const gameId = req.params.id;

    if (!gameId) {
        return res.status(400).json({ success: false, message: '缺少球局 ID' });
    }


    const players = await knex('GamePlayers')
        .join('Users', 'GamePlayers.UserId', '=', 'Users.Id')
        .select(
            'Users.Username',
            'GamePlayers.Status',
            'GamePlayers.JoinedAt'
        )
        .where('GamePlayers.GameId', gameId)
        .whereNull('GamePlayers.CanceledAt')
        .orderBy('GamePlayers.JoinedAt', 'asc');

    res.json({
        success: true,
        data: players,
        count: players.length
    });
};




module.exports = { createGame, getGame, getAllGames, deleteGame, joinGame, getJoinedGames, cancelJoin, playerList };
