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

    try {
        await knex.transaction(async (trx) => {
            const existingMatch = await trx('Matches')
                .where({ game_id: gameId, court_number: courtNumber, match_status: 'active' })
                .first();
            if (existingMatch) throw new Error(`場地 ${courtNumber} 正在對戰中`);

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

            const gamePlayerTableIds = [players.a1, players.a2, players.b1, players.b2];
            await trx('GamePlayers')
                .whereIn('Id', gamePlayerTableIds)
                .update({ status: 'playing' });
        });

        res.json({ success: true, message: `場地 ${courtNumber} 已開打` });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// 輔助函式：將 "Level 4-5：初階" 轉換為數字 4
const parseLevel = (levelStr) => {
    if (!levelStr) return 1;
    const match = levelStr.match(/\d+/);
    return match ? parseInt(match[0], 10) : 1;
};

const getLiveStatus = async (req, res) => {
    const { gameId } = req.params;

    if (!gameId || gameId === 'undefined') {
        return res.status(400).json({ success: false, message: "GameId is required" });
    }

    try {
        // 1. 撈取所有已確認的球員 (包括 IsVirtual = true 的朋友)
        const players = await knex('GamePlayers')
            .join('Users', 'GamePlayers.UserId', 'Users.Id')
            .where('GamePlayers.GameId', gameId)
            .where('GamePlayers.Status', 'CONFIRMED') // 只抓確認報名成功的人
            .select(
                'GamePlayers.Id as playerId',   // 這是每一筆紀錄的唯一 ID (包含虛擬球員)
                'Users.Username',
                'Users.badminton_level',
                'GamePlayers.FriendLevel',
                'GamePlayers.IsVirtual',
                'GamePlayers.status',
                'GamePlayers.games_played'
            );

        // 2. 格式化球員資料
        const formattedPlayers = players.map(p => {
            let finalLevel = 1;

            if (p.IsVirtual) {
                // ✅ 如果是虛擬球員（朋友），直接讀取 FriendLevel
                finalLevel = p.FriendLevel || 1;
            } else {
                // ✅ 如果是本人，從字串解析等級
                finalLevel = parseLevel(p.badminton_level);
            }

            return {
                playerId: p.playerId,
                displayName: p.IsVirtual ? `${p.Username} +1` : p.Username,
                status: p.status,
                level: finalLevel,
                games_played: p.games_played
            };
        });

        // 3. 撈取進行中的比賽
        const activeMatches = await knex('Matches')
            .where('game_id', gameId)
            .where('match_status', 'active')
            .select('*');

        res.json({
            success: true,
            data: {
                // 這裡的 players 已經包含所有人，直接回傳即可
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