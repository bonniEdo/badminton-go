const knex = require('../db');
const validator = require('validator');

const createGame = async (req, res) => {
    const trx = await knex.transaction();
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
        await trx('GamePlayers')
            .insert({
                GameId: newGame.GameId,
                UserId: userId,
                Status: 'CONFIRMED',
                JoinedAt: knex.fn.now(),
            });
        await trx.commit();

        res.status(201).json({
            success: true,
            message: '開團成功',
            game: newGame,
        });
    } catch (error) {
        await trx.rollback();
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，開團失敗歐'
        })
    }

};
const getGame = async (req, res) => {
    const userId = req.user.id;
    try {
        const activeGames = await knex('Games')
            .whereNull('CanceledAt')
            .where(
                { HostId: userId },
                { IsActive: true }
            )
            .select(
                'Games.GameId',
                'Games.Title',
                'Games.GameDateTime',
                'Games.Location',
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
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，無法取得您開的團'
        })

    }
}
const getAllGames = async (req, res) => {
    try {
        const activeGames = await knex('Games')
            .join('Users', 'Games.HostID', '=', 'Users.Id')
            .whereNull('CanceledAt')
            .select(
                'Games.GameId',
                'Games.Title',
                'Games.GameDateTime',
                'Games.Location',
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
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，取消失敗歐'
        })

    }
}


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
        if (!phone) {
            return res.status(400).json({ success: false, message: '缺少電話' });
        }

        // 2. 檢查是否已經有紀錄 (包含已取消的)
        const existingRecord = await trx('GamePlayers')
            .where({ GameId: gameId, UserId: userId })
            .first();

        // 3. 如果有紀錄，且狀態不是 CANCELED，代表重複報名
        if (existingRecord && existingRecord.Status !== 'CANCELED') {
            await trx.rollback();
            return res.status(400).json({ success: false, message: '已經報名過囉' });
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
        const [{ finalCount }] = await trx('GamePlayers')
            .where({ GameId: gameId, Status: 'CONFIRMED' })
            .count('* as finalCount');
        await trx('Games')
            .where({ GameId: gameId })
            .update({
                CurrentPlayers: finalCount
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

    } catch (error) {
        await trx.rollback(); // 失敗回滾
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，報名失敗歐'
        })
    }
}
const getJoinedGames = async (req, res) => {
    try {
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

    } catch (error) {
        console.error("Get Joined Games Error:", error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，無法取得報名紀錄'
        });
    }
};

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



module.exports = { createGame, getGame, getAllGames, deleteGame, joinGame, getJoinedGames, cancelJoin };
