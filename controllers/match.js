const knex = require('../db');
const { broadcastToGame } = require('../wsServer');

const ensureNumber = (val) => {
    const num = parseFloat(val);
    return isNaN(num) ? 1.0 : num;
};

const getNextGroupData = async (gameId, formattedPlayers) => {
    const row = await knex('GameNextGroups')
        .where({ game_id: gameId })
        .first();

    const slotPlayerIds = row
        ? [row.slot1_player_id, row.slot2_player_id, row.slot3_player_id, row.slot4_player_id]
        : [null, null, null, null];

    const players = slotPlayerIds
        .map((playerId, idx) => ({ playerId, slot: idx + 1 }))
        .filter(item => !!item.playerId)
        .map((item) => {
            const player = formattedPlayers.find(p => p.playerId === item.playerId);
            if (!player) return null;

            return {
                slot: item.slot,
                playerId: player.playerId,
                displayName: player.displayName,
                avatarUrl: player.avatarUrl || null,
                level: player.level,
                isHost: player.isHost
            };
        })
        .filter(Boolean);

    return { slotPlayerIds, players };
};

const setNextGroup = async (req, res) => {
    const { gameId, slots } = req.body;
    const hostUserId = req.user?.id || req.user?.UserId;

    if (!gameId) {
        return res.status(400).json({ success: false, message: '缺少 gameId' });
    }

    if (!Array.isArray(slots) || slots.length !== 4) {
        return res.status(400).json({ success: false, message: 'slots 格式錯誤，必須是 4 格陣列' });
    }

    const normalizedSlots = slots.map((val) => {
        if (val === null || val === undefined || val === '') return null;
        const num = Number(val);
        return Number.isInteger(num) ? num : NaN;
    });

    if (normalizedSlots.some(val => Number.isNaN(val))) {
        return res.status(400).json({ success: false, message: 'slots 內容錯誤，必須是 playerId 或 null' });
    }

    const nonNullSlots = normalizedSlots.filter(val => val !== null);
    const uniqueIds = [...new Set(nonNullSlots)];
    if (uniqueIds.length !== nonNullSlots.length) {
        return res.status(400).json({ success: false, message: '預備組不可有重複球員' });
    }

    try {
        const game = await knex('Games').where({ GameId: gameId }).select('HostID').first();
        if (!game || String(game.HostID) !== String(hostUserId)) {
            return res.status(403).json({ success: false, message: '僅團主可設定預備組' });
        }

        if (uniqueIds.length > 0) {
            const validRows = await knex('GamePlayers')
                .where({ GameId: gameId, status: 'idle' })
                .whereNull('CanceledAt')
                .whereNot('Status', 'CANCELED')
                .whereIn('Id', uniqueIds)
                .select('Id');

            if (validRows.length !== uniqueIds.length) {
                return res.status(400).json({ success: false, message: '預備組包含不可用球員（非待命、已取消或不屬於本場）' });
            }
        }

        const payload = {
            game_id: gameId,
            slot1_player_id: normalizedSlots[0],
            slot2_player_id: normalizedSlots[1],
            slot3_player_id: normalizedSlots[2],
            slot4_player_id: normalizedSlots[3],
            updated_at: knex.fn.now()
        };

        await knex('GameNextGroups')
            .insert(payload)
            .onConflict('game_id')
            .merge(payload);

        broadcastToGame(gameId);
        return res.json({ success: true, data: { slotPlayerIds: normalizedSlots } });
    } catch (error) {
        return res.status(500).json({ success: false, message: '設定預備組失敗' });
    }
};

const checkin = async (req, res) => {
    const { gameId } = req.body;
    const userId = req.user?.id || req.user?.UserId;

    const updatedCount = await knex('GamePlayers')
        .where({
            GameId: gameId,
            UserId: userId,
            status: 'waiting_checkin'
        })
        .update({
            status: 'idle',
            check_in_at: knex.fn.now()
        });

    if (updatedCount === 0) {
        return res.status(404).json({ success: false, message: '找不到掛號資訊' });
    }

    broadcastToGame(gameId);
    res.json({
        success: true,
        message: '報到成功，已為您及同伴簽下場蹤'
    });
};

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
                player_a1: players.a1 || null,
                player_a2: players.a2 || null,
                player_b1: players.b1 || null,
                player_b2: players.b2 || null,
                match_status: 'active',
                start_time: trx.fn.now()
            });

            const gamePlayerTableIds = [players.a1, players.a2, players.b1, players.b2].filter(Boolean);
            if (gamePlayerTableIds.length > 0) {
                await trx('GamePlayers')
                    .whereIn('Id', gamePlayerTableIds)
                    .update({ status: 'playing' });
            }

            await trx('GameNextGroups')
                .where({ game_id: gameId })
                .update({
                    slot1_player_id: null,
                    slot2_player_id: null,
                    slot3_player_id: null,
                    slot4_player_id: null,
                    updated_at: trx.fn.now()
                });
        });

        broadcastToGame(gameId);
        res.json({ success: true, message: `場地 ${courtNumber} 已開打` });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

const getLiveStatus = async (req, res) => {
    const { gameId } = req.params;
    if (!gameId || gameId === 'undefined') return res.status(400).json({ success: false, message: "GameId is required" });

    const game = await knex('Games').where({ GameId: gameId }).select('HostID').first();
    const hostId = game ? game.HostID : null;

    const players = await knex('GamePlayers')
        .leftJoin('Users', 'GamePlayers.UserId', 'Users.Id')
        .where('GamePlayers.GameId', gameId)
        .whereNull('GamePlayers.CanceledAt')
        .whereNot('GamePlayers.Status', 'CANCELED')
        .select(
            'GamePlayers.Id as playerId',
            'GamePlayers.UserId',
            'Users.Username',
            'Users.AvatarUrl',
            'Users.badminton_level',
            'Users.verified_matches',
            'GamePlayers.FriendLevel',
            'GamePlayers.IsVirtual',
            'GamePlayers.Status as enrollStatus',
            'GamePlayers.status',
            'GamePlayers.games_played',
            'GamePlayers.check_in_at',
            'GamePlayers.paid_at'
        );

    const formattedPlayers = players.map(p => ({
        playerId: p.playerId,
        displayName: p.IsVirtual ? `${p.Username} +1` : p.Username,
        avatarUrl: p.AvatarUrl || null,
        status: p.status,
        enrollStatus: p.enrollStatus,
        level: p.IsVirtual ? ensureNumber(p.FriendLevel) : ensureNumber(p.badminton_level),
        games_played: p.games_played,
        verified_matches: p.verified_matches || 0,
        check_in_at: p.check_in_at,
        paid_at: p.paid_at || null,
        isHost: !p.IsVirtual && p.UserId === hostId,
    }));

    const activeMatches = await knex('Matches').where({ game_id: gameId, match_status: 'active' }).select('*');

    const userId = req.user?.id;
    const myEntry = userId ? formattedPlayers.find(p => {
        const raw = players.find(r => r.playerId === p.playerId);
        return raw && !raw.IsVirtual && raw.UserId === userId;
    }) : null;

    const nextGroup = await getNextGroupData(gameId, formattedPlayers);

    res.json({
        success: true,
        data: {
            players: formattedPlayers,
            matches: activeMatches,
            myPlayerId: myEntry?.playerId || null,
            nextGroup
        }
    });
};

const finishMatch = async (req, res) => {
    const { matchId, winner } = req.body;
    await knex.transaction(async (trx) => {
        const match = await trx('Matches').where({ id: matchId }).first();
        if (!match) throw new Error("找不到比賽紀錄");

        const playerIds = [match.player_a1, match.player_a2, match.player_b1, match.player_b2].filter(Boolean);

        const playerDetails = playerIds.length > 0
            ? await trx('GamePlayers')
                .leftJoin('Users', 'GamePlayers.UserId', 'Users.Id')
                .whereIn('GamePlayers.Id', playerIds)
                .select(
                    'GamePlayers.Id',
                    'GamePlayers.UserId',
                    'GamePlayers.IsVirtual',
                    'GamePlayers.FriendLevel',
                    'Users.badminton_level',
                    'Users.verified_matches'
                )
            : [];

        const virtualCount = playerDetails.filter(p => !!p.IsVirtual).length;
        const teamAIds = [match.player_a1, match.player_a2].filter(Boolean);
        const teamBIds = [match.player_b1, match.player_b2].filter(Boolean);
        const canGrade = teamAIds.length > 0 && teamBIds.length > 0 && playerDetails.length === playerIds.length;
        let isGraded = false;

        if ((winner === 'A' || winner === 'B') && virtualCount < 2 && canGrade) {
            isGraded = true;
            const pMap = {};
            playerDetails.forEach(p => {
                pMap[p.Id] = {
                    level: !!p.IsVirtual ? ensureNumber(p.FriendLevel) : ensureNumber(p.badminton_level),
                    isVirtual: !!p.IsVirtual,
                    userId: p.UserId
                };
            });

            const ratingA = teamAIds.reduce((sum, id) => sum + pMap[id].level, 0) / teamAIds.length;
            const ratingB = teamBIds.reduce((sum, id) => sum + pMap[id].level, 0) / teamBIds.length;

            const K = 0.5;
            const DIVISOR = 5;
            const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / DIVISOR));
            const scoreA = (winner === 'A') ? 1 : 0;

            const changeA = K * (scoreA - expectedA);
            const changeB = -changeA;

            for (let pid of playerIds) {
                const p = pMap[pid];
                if (p.isVirtual) continue;

                const change = teamAIds.includes(pid) ? changeA : changeB;
                const newLevel = Math.max(1.0, parseFloat((p.level + change).toFixed(2)));

                await trx('Users').where({ Id: p.userId }).update({
                    badminton_level: newLevel,
                    verified_matches: trx.raw('verified_matches + 1')
                });
            }
        }

        await trx('Matches').where({ id: matchId }).update({
            match_status: 'finished',
            winner: winner,
            end_time: trx.fn.now()
        });

        if (playerIds.length > 0) {
            await trx('GamePlayers')
                .whereIn('Id', playerIds)
                .update({ status: 'idle', last_end_time: trx.fn.now() })
                .increment('games_played', 1);
        }

        broadcastToGame(match.game_id);
        res.json({
            success: true,
            message: isGraded
                ? '戰報錄入成功，病友戰力與認證進度已更新'
                : (virtualCount >= 2 ? '同伴人數過多 (>=2)，本局不計入認證' : '對戰已結束 (未計分)')
        });
    });
};

const getMyHistory = async (req, res) => {
    const userId = req.user?.id || req.user?.UserId;
    const myEntries = await knex('GamePlayers').where({ UserId: userId }).select('Id');
    const myPlayerIds = myEntries.map(p => p.Id);

    if (myPlayerIds.length === 0) return res.json({ success: true, data: [] });

    const myMatches = await knex('Matches')
        .leftJoin('Games', 'Matches.game_id', 'Games.GameId')
        .whereIn('player_a1', myPlayerIds)
        .orWhereIn('player_a2', myPlayerIds)
        .orWhereIn('player_b1', myPlayerIds)
        .orWhereIn('player_b2', myPlayerIds)
        .select(
            'Matches.id',
            'Matches.court_number',
            'Matches.winner',
            'Matches.player_a1',
            'Matches.player_a2',
            'Games.Location',
            'Games.GameDateTime'
        )
        .orderBy('Matches.id', 'desc')
        .limit(20);

    const formattedHistory = myMatches.map(m => {
        let result = 'draw';

        if (m.winner && m.winner !== 'none') {
            const isTeamA = myPlayerIds.includes(m.player_a1) || myPlayerIds.includes(m.player_a2);
            const myTeam = isTeamA ? 'A' : 'B';

            result = (m.winner === myTeam) ? 'win' : 'loss';
        }

        return {
            match_id: m.id,
            court_number: m.court_number,
            location: m.Location,
            result: result,
            date: m.GameDateTime
        };
    });

    res.json({ success: true, data: formattedHistory });
};

const hostCheckin = async (req, res) => {
    const { gameId, playerId } = req.body;
    const hostUserId = req.user?.id || req.user?.UserId;

    try {
        const game = await knex('Games').where({ GameId: gameId }).select('HostID').first();
        if (!game || game.HostID !== hostUserId) {
            return res.status(403).json({ success: false, message: '僅團主可執行此操作' });
        }

        const targetPlayer = await knex('GamePlayers')
            .where({ Id: playerId, GameId: gameId })
            .whereNot('Status', 'CANCELED')
            .select('UserId')
            .first();

        if (!targetPlayer) {
            return res.status(404).json({ success: false, message: '找不到該掛號資訊' });
        }

        const updatedCount = await knex('GamePlayers')
            .where({ GameId: gameId, UserId: targetPlayer.UserId, status: 'waiting_checkin' })
            .whereNot('Status', 'CANCELED')
            .update({ status: 'idle', check_in_at: knex.fn.now() });

        broadcastToGame(gameId);
        res.json({ success: true, message: `已為該病友報到 (${updatedCount} 筆更新)` });
    } catch (err) {
        console.error('hostCheckin error:', err);
        res.status(500).json({ success: false, message: '報到失敗' });
    }
};

module.exports = { checkin, hostCheckin, setNextGroup, startMatch, getLiveStatus, finishMatch, getMyHistory };
