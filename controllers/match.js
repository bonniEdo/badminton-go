const knex = require('../db');

const ensureNumber = (val) => {
    const num = parseFloat(val);
    return isNaN(num) ? 1.0 : num;
};

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
        return res.status(404).json({ success: false, message: '找不到掛號資訊' });
    }

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

    res.json({ success: true, data: { players: formattedPlayers, matches: activeMatches, myPlayerId: myEntry?.playerId || null } });
};

const finishMatch = async (req, res) => {
    const { matchId, winner } = req.body;
    await knex.transaction(async (trx) => {
        const match = await trx('Matches').where({ id: matchId }).first();
        if (!match) throw new Error("找不到比賽紀錄");

        const playerIds = [match.player_a1, match.player_a2, match.player_b1, match.player_b2];

        const playerDetails = await trx('GamePlayers')
            .leftJoin('Users', 'GamePlayers.UserId', 'Users.Id')
            .whereIn('GamePlayers.Id', playerIds)
            .select(
                'GamePlayers.Id',
                'GamePlayers.UserId',
                'GamePlayers.IsVirtual',
                'GamePlayers.FriendLevel',
                'Users.badminton_level',
                'Users.verified_matches'
            );

        if (playerDetails.length !== 4) {
            console.error(`Match ${matchId} 球員資料不齊全, 僅抓到 ${playerDetails.length} 筆`);
        }

        const virtualCount = playerDetails.filter(p => !!p.IsVirtual).length;
        let isGraded = false;

        if ((winner === 'A' || winner === 'B') && virtualCount < 2) {
            isGraded = true;
            const pMap = {};
            playerDetails.forEach(p => {
                pMap[p.Id] = {
                    level: !!p.IsVirtual ? ensureNumber(p.FriendLevel) : ensureNumber(p.badminton_level),
                    isVirtual: !!p.IsVirtual,
                    userId: p.UserId
                };
            });

            const ratingA = (pMap[match.player_a1].level + pMap[match.player_a2].level) / 2;
            const ratingB = (pMap[match.player_b1].level + pMap[match.player_b2].level) / 2;

            const K = 0.5;
            const DIVISOR = 5;
            const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / DIVISOR));
            const scoreA = (winner === 'A') ? 1 : 0;

            const changeA = K * (scoreA - expectedA);
            const changeB = -changeA;

            for (let pid of playerIds) {
                const p = pMap[pid];
                if (p.isVirtual) continue;

                const change = (pid === match.player_a1 || pid === match.player_a2) ? changeA : changeB;
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

        await trx('GamePlayers')
            .whereIn('Id', playerIds)
            .update({ status: 'idle', last_end_time: trx.fn.now() })
            .increment('games_played', 1);

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
            .where({ GameId: gameId, UserId: targetPlayer.UserId })
            .whereNot('Status', 'CANCELED')
            .update({ status: 'idle', check_in_at: knex.fn.now() });

        res.json({ success: true, message: `已為該病友報到 (${updatedCount} 筆更新)` });
    } catch (err) {
        console.error('hostCheckin error:', err);
        res.status(500).json({ success: false, message: '報到失敗' });
    }
};

module.exports = { checkin, hostCheckin, startMatch, getLiveStatus, finishMatch, getMyHistory };