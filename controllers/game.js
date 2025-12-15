const knex = require('../db');
const validator = require('validator');

const createGame = async (req, res) => {
    try {
        const userId = req.user.id;
        const { title, gameDate, gameTime, location, maxPlayers, price } = req.body;
        // console.log(req.body)
        const gameDateTime = `${gameDate} ${gameTime}`;

        if (!title) {
            console.warn('缺少名稱');
            return res.status(400).json({
                success: false,
                message: '缺少名稱'
            })
        }
        if (!gameDate) {
            console.warn('缺少日期');
            return res.status(400).json({
                success: false,
                message: '缺少日期'
            })
        }
        if (!validator.isDate(gameDate, { format: 'YYYY-MM-DD', strictMode: true })) {
            console.warn(`日期格式錯誤, ${gameDate}`);
            return res.status(400).json({ message: '日期格式錯誤，請使用 YYYY-MM-DD 格式' });
        }
        if (!maxPlayers) {
            return res.status(400).json({
                success: false,
                message: '缺少人數上限'
            })
        }
        if (!gameTime) {
            console.warn('缺少時間');
            return res.status(400).json({
                success: false,
                message: '缺少開打時間'
            })
        }
        if (!validator.isTime(gameTime, { hourFormat: 'hour24' })) {
            console.warn(`時間格式錯誤, ${gameTime}`);
            return res.status(400).json({ message: '日期格式錯誤，請使用24小時制 hh:mm 格式' });
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
            return res.status(400).json({
                success: false,
                message: '已有同時段同地點團囉！請勿重複建立。'
            });
        }
        const [newGame] = await knex('Games')
            .insert({
                Title: title,
                GameDateTime: gameDateTime,
                Location: location,
                MaxPlayers: maxPlayers,
                Price: price,
                HostID: userId,
                IsActive: true,
            })
            .returning('*')
        const joinUrl = process.env.JOIN_URL;
        const shareLink = `${joinUrl}/games/${newGame.GameId}/join`;
        console.log(shareLink)

        res.status(201).json({
            success: true,
            message: '開團成功',
            game: newGame,
            shareLink: shareLink
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，開團失敗歐'
        })
    }

};

const deleteGame = async (req, res) => {
    try {
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
            return res.status(404).json({ success: false, message: '找不到此球團' });
        }

        if (String(game.HostID) !== String(userId)) {
            return res.status(403).json({ success: false, message: '權限不足，只有團主可以取消此團' });
        }

        if (!game.IsActive || game.CanceledAt) {
            return res.status(400).json({ success: false, message: '此團已經取消過了' });
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
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，取消失敗歐'
        })
    }



}
const joinGame = async (req, res) => {
    const trx = await knex.transaction();

    try {
        // console.log("111")
        const gameId = req.params.id;
        const userId = req.user.id;
        const phone = req.body.phone

        const game = await knex('Games').where({ GameId: gameId }).first();
        if (!game) {
            return res.status(404).json({ success: false, message: '沒有此球團' })

        }
        if (!game.IsActive || game.CanceledAt) {
            return res.status(400).json({ success: false, message: '此團已被取消' });
        }
        const signupAlready = await knex('GamePlayers').where({ GameId: gameId, UserId: userId }).whereNot('Status', 'CANCELED')
            .first();
        if (signupAlready) {
            return res.status(400).json({ success: false, message: '已經報名過摟' })
        }
        if (!phone) {
            return res.status(400).json({ success: false, message: '缺少電話' })
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

        const join = await knex('GamePlayers')
            .insert({
                GameId: gameId,
                UserId: userId,
                PhoneNumber: phone,
                Status: status,
                JoinedAt: knex.fn.now(),
            })
            .returning('*');
        await trx.commit();
        res.status(201).json({
            success: true,
            message: status === 'CONFIRMED'
                ? '報名成功'
                : `名額已滿，你目前是候補第 ${waitlistOrder} 位`,
            game: join,
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，報名失敗歐'
        })
    }
}

const cancelJoin = async (req, res) => {
    const trx = await knex.transaction();

    try {
        const gameId = req.params.id;
        const userId = req.user.id;

        const player = await trx('GamePlayers')
            .where({ GameId: gameId, UserId: userId })
            .whereNot('Status', 'CANCELED')
            .first();

        if (!player) {
            await trx.rollback();
            return res.status(404).json({ success: false, message: '找不到報名紀錄或已取消' });
        }

        const wasConfirmed = player.Status === 'CONFIRMED';

        await trx('GamePlayers')
            .where({ GameId: gameId, UserId: userId })
            .update({
                Status: 'CANCELED',
                CanceledAt: knex.fn.now(),
            });

        let promoted = null;

        if (wasConfirmed) {
            const nextWait = await trx('GamePlayers')
                .where({ GameId: gameId, Status: 'WAITLIST' })
                .orderBy('JoinedAt', 'asc')
                .first();

            if (nextWait) {
                await trx('GamePlayers')
                    .where({ GameId: gameId, UserId: nextWait.UserId })
                    .update({
                        Status: 'CONFIRMED',
                        PromotedAt: knex.fn.now(),
                    });

                promoted = {
                    userId: nextWait.UserId,
                    from: 'WAITLIST',
                    to: 'CONFIRMED',
                };
            }
        }

        await trx.commit();

        return res.status(200).json({
            success: true,
            message: promoted ? '取消成功，已自動遞補 1 位候補' : '取消成功',
            promoted,
        });
    } catch (error) {
        await trx.rollback();
        console.error(error);
        return res.status(500).json({ success: false, message: '取消失敗，發生意外錯誤' });
    }
};



module.exports = { createGame, deleteGame, joinGame, cancelJoin };
