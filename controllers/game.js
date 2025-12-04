const knex = require('../db');
const validator = require('validator');

const createGame = async (req, res) => {
    try {
        const { title, gameDate, location, maxPlayers, price, dateTime } = req.body;
        // console.log(req.body)
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
        if (!dateTime) {
            console.warn('缺少時間');
            return res.status(400).json({
                success: false,
                message: '缺少開打時間'
            })
        }
        if (!validator.isTime(dateTime, { hourFormat: 'hour24' })) {
            console.warn(`時間格式錯誤, ${dateTime}`);
            return res.status(400).json({ message: '日期格式錯誤，請使用24小時制 hh:mm 格式' });
        }
        const [newGame] = await knex('Games')
            .insert({
                Title: title,
                GameDate: gameDate,
                Location: location,
                MaxPlayers: maxPlayers,
                Price: price,
                dateTime
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

const DeleteGame = async (req, res) => {
    try {
        const { title, gameDate, location } = req.body;
        if (!title) {
            console.warn('缺少球團名稱');
            return res.status(400).json({
                success: false,
                message: '缺少球團名稱'
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
        if (!dateTime) {
            console.warn('缺少時間');
            return res.status(400).json({
                success: false,
                message: '缺少開打時間'
            })
        }
        if (!validator.isTime(dateTime, { hourFormat: 'hour24' })) {
            console.warn(`時間格式錯誤, ${dateTime}`);
            return res.status(400).json({ message: '日期格式錯誤，請使用24小時制 hh:mm 格式' });
        }
        const [newGame] = await knex('Games')
            .insert({
                Title: title,
                GameDate: gameDate,
                Location: location,
            })
            .returning('*')
        res.status(201).json({
            success: true,
            message: '取消成功',
            game: newGame
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，開團失敗歐'
        })
    }

}

module.exports = { createGame, DeleteGame };
