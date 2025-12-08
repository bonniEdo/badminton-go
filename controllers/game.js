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
        res.status(201).json({
            success: true,
            message: '開團成功',
            game: newGame
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

module.exports = { createGame, deleteGame };
