const knex = require('../db');
const checkin = async (req, res) => {
    const { gameId } = req.body;
    const userId = req.user?.id || req.user?.UserId;

    const updatedCount = await knex('GamePlayers')
        .where({
            GameId: gameId,
            UserId: userId
        })
        .update({
            status: 'idle',
            check_in_at: knex.fn.now()
        });

    if (updatedCount === 0) {
        return res.status(404).json({ success: false, message: '找不到報名資訊' });
    }

    res.json({
        success: true,
        message: `簽到成功，已為您及朋友(共 ${updatedCount} 位)簽下場蹤`
    });
}

const startMatch = async (req, res) => {
    const { gameId, courtNumber, players } = req.body;
    // players 格式: { a1: player_pk_id, a2: ..., b1: ..., b2: ... }

    await knex.transaction(async (trx) => {
        // 1. 建立對戰紀錄
        await trx('Matches').insert({
            game_id: gameId,
            court_number: courtNumber,
            player_a1: players.a1,
            player_a2: players.a2,
            player_b1: players.b1,
            player_b2: players.b2,
            match_status: 'active',
            start_time: trx.fn.now()
        });

        // 2. ✅ 修正點：使用 GamePlayers 的主鍵 Id 來更新狀態
        // 之前可能誤用了 UserId，導致虛擬球員沒被正確更新
        const gamePlayerTableIds = [players.a1, players.a2, players.b1, players.b2];

        await trx('GamePlayers')
            .whereIn('Id', gamePlayerTableIds) // 👈 這裡一定要對齊資料庫的大寫 'Id'
            .update({ status: 'playing' });
    });

    res.json({ success: true, message: `場地 ${courtNumber} 已開打` });
};

const getLiveStatus = async (req, res) => {
    const { gameId } = req.params;

    if (!gameId || gameId === 'undefined') {
        return res.status(400).json({ success: false, message: "GameId is required" });
    }

    try {
        const players = await knex('GamePlayers')
            .join('Users', 'GamePlayers.UserId', 'Users.Id')
            .where('GamePlayers.GameId', gameId)
            .where('GamePlayers.Status', 'CONFIRMED')
            .select(
                'GamePlayers.Id as playerId',
                'Users.Username',
                'GamePlayers.IsVirtual',
                'GamePlayers.status',
                'GamePlayers.games_played'
            );

        const formattedPlayers = players.map(p => ({
            ...p,
            displayName: p.IsVirtual ? `${p.Username} +1` : p.Username
        }));

        const activeMatches = await knex('Matches')
            .where('game_id', gameId)
            .where('match_status', 'active')
            .select('*');

        res.json({
            success: true,
            data: {
                // ✅ 確保前端能拿到 players 與 matches 欄位
                players: formattedPlayers,
                matches: activeMatches
            }
        });
    } catch (error) {
        console.error("SQL Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

const finishMatch = async (req, res) => {
    const { matchId } = req.body;

    await knex.transaction(async (trx) => {
        // 1. 這裡也要注意，Matches 表的 ID 是小寫還是大寫？ 
        // 根據你之前的 migration，Matches 應該是小寫 id
        const match = await trx('Matches').where({ id: matchId }).first();
        if (!match) throw new Error("找不到比賽紀錄");

        const playerIds = [match.player_a1, match.player_a2, match.player_b1, match.player_b2];

        // A. 更新比賽狀態
        await trx('Matches').where({ id: matchId }).update({
            match_status: 'finished',
            end_time: trx.fn.now()
        });

        // B. 將 4 位球員放回「休息區」
        await trx('GamePlayers')
            // ✅ 修正點：將小寫 'id' 改成大寫 'Id' (對齊你的資料庫欄位)
            .whereIn('Id', playerIds)
            .update({
                status: 'idle',
                last_end_time: trx.fn.now()
            })
            .increment('games_played', 1);
    });

    res.json({ success: true, message: '對戰結束，球員已回歸休息區' });
};

module.exports = { checkin, startMatch, getLiveStatus, finishMatch };