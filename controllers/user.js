require('dotenv').config();

const knex = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const AppError = require('../utils/appError');
const validator = require('validator');
const axios = require('axios');
const dayjs = require('dayjs');
const { createLoginCode, consumeLoginCode } = require('../utils/loginCodeStore');
const { createOAuthState, consumeOAuthState } = require('../utils/oauthStateStore');

const parseAllowlist = (rawValue) => String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const normalizeOrigin = (urlValue, label) => {
    try {
        return new URL(urlValue).origin;
    } catch (_) {
        throw new AppError(`${label} must be a valid absolute URL`, 500);
    }
};

const normalizeAbsoluteUrl = (urlValue, label) => {
    try {
        const parsed = new URL(urlValue);
        return parsed.toString();
    } catch (_) {
        throw new AppError(`${label} must be a valid absolute URL`, 500);
    }
};

const validateEnvUrlAgainstAllowlist = (envKey, allowlistKey) => {
    const envValue = String(process.env[envKey] || '').trim();
    if (!envValue) {
        throw new AppError(`${envKey} is not configured`, 500);
    }

    const targetOrigin = normalizeOrigin(envValue, envKey);
    const allowlist = parseAllowlist(process.env[allowlistKey]);
    if (allowlist.length === 0) {
        throw new AppError(`${allowlistKey} is not configured`, 500);
    }

    const allowedOrigins = allowlist.map((item) => normalizeOrigin(item, allowlistKey));
    if (!allowedOrigins.includes(targetOrigin)) {
        throw new AppError(`${envKey} origin is not allowed`, 500);
    }

    return envValue;
};

const getFrontendBaseUrl = () => normalizeOrigin(
    validateEnvUrlAgainstAllowlist('FRONTEND_URL', 'OAUTH_FRONTEND_URL_ALLOWLIST'),
    'FRONTEND_URL'
);
const getLineCallbackUrl = () => normalizeAbsoluteUrl(
    validateEnvUrlAgainstAllowlist('LINE_CALLBACK_URL', 'OAUTH_CALLBACK_URL_ALLOWLIST'),
    'LINE_CALLBACK_URL'
);
const getGoogleCallbackUrl = () => normalizeAbsoluteUrl(
    validateEnvUrlAgainstAllowlist('GOOGLE_CALLBACK_URL', 'OAUTH_CALLBACK_URL_ALLOWLIST'),
    'GOOGLE_CALLBACK_URL'
);
const getFacebookCallbackUrl = () => normalizeAbsoluteUrl(
    validateEnvUrlAgainstAllowlist('FACEBOOK_CALLBACK_URL', 'OAUTH_CALLBACK_URL_ALLOWLIST'),
    'FACEBOOK_CALLBACK_URL'
);

const redirectToFrontend = (res, pathWithQuery) => {
    try {
        return res.redirect(`${getFrontendBaseUrl()}${pathWithQuery}`);
    } catch (error) {
        console.error('OAuth redirect blocked:', error.message);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: 'OAuth redirect blocked by URL allowlist'
        });
    }
};

const validateOAuthState = (req, provider) => {
    const incomingState = req.query?.state;
    if (!consumeOAuthState(provider, incomingState)) {
        throw new AppError('OAuth state validation failed', 401);
    }
};

const formatUserResponse = (user) => ({
    id: user.Id,
    username: user.Username,
    email: user.Email,
    avatarUrl: user.AvatarUrl || user.avatar_url,
    is_profile_completed: !!user.is_profile_completed,
    badminton_level: user.badminton_level,
    is_ranking_public: user.is_ranking_public !== false,
});

const buildAvatarAssetUrl = (req, userId, avatarUrl) => {
    if (!avatarUrl || typeof avatarUrl !== 'string') return null;
    if (!avatarUrl.startsWith('data:image/')) return avatarUrl;
    if (!userId) return null;
    const origin = `${req.protocol}://${req.get('host')}`;
    return `${origin}/api/user/avatar/${userId}`;
};

const RANKING_SNAPSHOT_TZ = process.env.RANKING_SNAPSHOT_TZ || 'Asia/Taipei';

const getRankingSnapshotDateKey = (date = new Date()) => {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: RANKING_SNAPSHOT_TZ,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const parts = formatter.formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) return dayjs(date).format('YYYY-MM-DD');
    return `${year}-${month}-${day}`;
};

const buildRankingVisibilityMap = (users) => {
    const map = new Map();
    for (const user of users || []) {
        const userId = Number(user?.Id);
        if (!Number.isInteger(userId) || userId <= 0) continue;
        map.set(userId, user?.is_ranking_public !== false);
    }
    return map;
};

const normalizeRankedRows = (rows) => {
    let sourceRows = rows;
    if (typeof sourceRows === 'string') {
        try {
            sourceRows = JSON.parse(sourceRows);
        } catch (_) {
            sourceRows = [];
        }
    }
    if (!Array.isArray(sourceRows)) return [];

    return sourceRows
        .filter((row) => row && Number.isInteger(Number(row.userId)) && Number(row.userId) > 0)
        .map((row) => ({
            ...row,
            userId: Number(row.userId),
            rank: Number(row.rank || 0),
            isRankingPublic: row?.isRankingPublic !== false
        }))
        .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
};

const buildRankingPayloadForViewer = ({
    rankedAll,
    currentUserId,
    type,
    generatedAt,
    windowDays,
    publicLimit,
    visibilityByUserId
}) => {
    const safeRows = normalizeRankedRows(rankedAll);
    const resolveIsPublic = (row) => {
        const fromMap = visibilityByUserId?.get(Number(row.userId));
        if (typeof fromMap === 'boolean') return fromMap;
        return row?.isRankingPublic !== false;
    };

    const myRankRaw = currentUserId
        ? safeRows.find((row) => Number(row.userId) === Number(currentUserId)) || null
        : null;
    const myVisibility = myRankRaw ? resolveIsPublic(myRankRaw) : true;

    const maskRowForViewer = (row) => {
        const isSelf = !!currentUserId && Number(row.userId) === Number(currentUserId);
        const canViewDetail = isSelf || resolveIsPublic(row);
        if (canViewDetail) return { ...row, masked: false };

        return {
            ...row,
            masked: true,
            matches: null,
            wins: null,
            losses: null,
            winRate: null,
            recentMatches: null,
            recentWins: null,
            recentLosses: null,
            recentWinRate: null,
            currentWeekMatches: null,
            currentWeekWins: null,
            currentWeekLosses: null,
            prevWeekMatches: null,
            prevWeekWins: null,
            prevWeekLosses: null,
            currentWeekWinRate: null,
            prevWeekWinRate: null,
            score: null,
            mentorBonus: null,
            activityScore: null,
            progressScore: null,
            progressWinRateDelta: null,
            trend: null,
            currentWeekScore: null,
            previousWeekScore: null,
            weeklyRankDelta: null,
        };
    };

    const leaderboard = safeRows.slice(0, publicLimit).map(maskRowForViewer);
    const podium = safeRows.slice(0, 3).map(maskRowForViewer);
    const aroundMe = myRankRaw
        ? safeRows
            .slice(Math.max(0, Number(myRankRaw.rank) - 3), Math.min(safeRows.length, Number(myRankRaw.rank) + 2))
            .map(maskRowForViewer)
        : [];

    return {
        type,
        generatedAt,
        leaderboard,
        podium,
        aroundMe,
        myRank: myRankRaw ? maskRowForViewer(myRankRaw) : null,
        myVisibility,
        total: safeRows.length,
        totalAll: safeRows.length,
        windowDays,
        publicLimit
    };
};

const createUser = async (req, res) => {
    const { username, email, password } = req.body;
    if (!username) throw new AppError('Username is required', 400);

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail || !validator.isEmail(normalizedEmail)) {
        throw new AppError('Invalid email format', 400);
    }

    const existingUser = await knex('Users').where({ Email: normalizedEmail }).first();
    if (existingUser) throw new AppError('Email already exists', 400);

    if (!password) throw new AppError('Password is required', 400);

    const hashedPassword = await bcrypt.hash(password, 10);

    const [newUser] = await knex('Users')
        .insert({
            Username: username,
            Email: normalizedEmail,
            Password: hashedPassword,
            badminton_level: 1.00
        })
        .returning('*');

    res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: formatUserResponse(newUser)
    });
};

const loginUser = async (req, res) => {
    const { email, password } = req.body;
    const user = await knex('Users').where({ Email: email.toLowerCase().trim() }).first();

    if (!user || !user.Password) {
        throw new AppError('Invalid credentials or social-login account', 401);
    }

    const isMatch = await bcrypt.compare(password, user.Password);
    if (!isMatch) throw new AppError('Incorrect password', 401);

    const token = jwt.sign(
        { id: user.Id, email: user.Email, username: user.Username },
        JWT_SECRET,
        { expiresIn: '30min' }
    );
    console.log("User login success")

    res.json({
        success: true,
        message: 'Login success',
        token,
        user: {
            id: user.Id,
            username: user.Username,
            is_profile_completed: !!user.is_profile_completed,
            badminton_level: user.badminton_level,
            is_ranking_public: user.is_ranking_public !== false,
        }
    });
};

const logoutUser = async (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Logout success'
    });
};

const getLineAuthUrl = (req, res) => {
    const state = createOAuthState('line');
    const client_id = process.env.LINE_CHANNEL_ID;
    const redirect_uri = encodeURIComponent(getLineCallbackUrl());
    const scope = 'profile openid email';

    const url = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}&state=${state}&scope=${scope}`;
    res.json({ url });
};

const lineCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) return redirectToFrontend(res, '/login?error=no_code');

    try {
        validateOAuthState(req, 'line');
        const lineCallbackUrl = getLineCallbackUrl();
        const tokenResponse = await axios.post('https://api.line.me/oauth2/v2.1/token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: lineCallbackUrl,
                client_id: process.env.LINE_CHANNEL_ID,
                client_secret: process.env.LINE_CHANNEL_SECRET,
            }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const { id_token } = tokenResponse.data;
        const verifyResponse = await axios.post(
            'https://api.line.me/oauth2/v2.1/verify',
            new URLSearchParams({
                id_token,
                client_id: process.env.LINE_CHANNEL_ID,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const lineUser = verifyResponse.data;
        const { sub: lineId, name, picture, email } = lineUser;

        let user = await knex('Users').where({ LineId: lineId }).first();

        if (!user) {
            const preferredEmail = email ? email.toLowerCase() : `${lineId}@line.com`;
            let safeEmail = preferredEmail;
            const existingEmailUser = await knex('Users').where({ Email: preferredEmail }).first();
            if (existingEmailUser && String(existingEmailUser.LineId || '') !== String(lineId)) {
                safeEmail = `${lineId}@line.com`;
            }

            const [newUser] = await knex('Users')
                .insert({
                    Username: name,
                    Email: safeEmail,
                    LineId: lineId,
                    AvatarUrl: picture,
                    badminton_level: 1.00,
                    is_profile_completed: false
                })
                .returning('*');
            user = newUser;
        }

        const token = jwt.sign(
            { id: user.Id, email: user.Email, username: user.Username },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        console.log("LINE login success")

        const loginCode = createLoginCode({
            token,
            user: formatUserResponse(user)
        });
        return redirectToFrontend(res, `/login-success?code=${loginCode}`);

    } catch (error) {
        console.error('LINE Login Error:', error.response?.data || error.message);
        return redirectToFrontend(res, '/login?error=line_failed');
    }
};

const liffLogin = async (req, res) => {
    const { idToken } = req.body;

    try {
        const response = await axios.post('https://api.line.me/oauth2/v2.1/verify',
            new URLSearchParams({
                id_token: idToken,
                client_id: process.env.LINE_CHANNEL_ID,
            })
        );

        const { sub: lineId, name, picture, email } = response.data;

        let user = await knex('Users').where({ LineId: lineId }).first();

        if (!user) {
            const [newUser] = await knex('Users').insert({
                Username: name,
                Email: email || `${lineId}@line.com`,
                LineId: lineId,
                AvatarUrl: picture,
            }).returning('*');
            user = newUser;
        }

        const token = jwt.sign(
            { id: user.Id, email: user.Email, username: user.Username },
            process.env.JWT_SECRET,
            { expiresIn: '60d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.Id,
                username: user.Username,
                avatarUrl: user.AvatarUrl,
                is_profile_completed: !!user.is_profile_completed,
                badminton_level: user.badminton_level,
                is_ranking_public: user.is_ranking_public !== false,
            }
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'LIFF login failed' });
    }
};
const getGoogleAuthUrl = (req, res) => {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
        redirect_uri: getGoogleCallbackUrl(),
        client_id: process.env.GOOGLE_CLIENT_ID,
        access_type: 'offline',
        response_type: 'code',
        prompt: 'consent',
        scope: [
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email',
        ].join(' '),
        state: createOAuthState('google'),
    };

    const url = `${rootUrl}?${new URLSearchParams(options).toString()}`;
    res.json({ url });
};

const googleCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) return redirectToFrontend(res, '/login?error=no_code');

    try {
        validateOAuthState(req, 'google');
        const googleCallbackUrl = getGoogleCallbackUrl();
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: googleCallbackUrl,
            grant_type: 'authorization_code',
        });

        const { access_token } = tokenResponse.data;

        const userResponse = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` }
        });

        const { sub: googleId, name, picture, email } = userResponse.data;

        let user = await knex('Users').where({ GoogleId: googleId }).first();

        if (!user) {
            const existingEmailUser = await knex('Users').where({ Email: email.toLowerCase() }).first();

            if (existingEmailUser) {
                await knex('Users').where({ Id: existingEmailUser.Id }).update({
                    GoogleId: googleId,
                    AvatarUrl: picture || existingEmailUser.AvatarUrl
                });
                user = { ...existingEmailUser, GoogleId: googleId };
            } else {
                // Create a new account for first-time Google users.
                const [newUser] = await knex('Users')
                    .insert({
                        Username: name,
                        Email: email.toLowerCase(),
                        GoogleId: googleId,
                        AvatarUrl: picture,
                        badminton_level: 1.00,
                        is_profile_completed: false
                    })
                    .returning('*');
                user = newUser;
            }
        }

        const token = jwt.sign(
            { id: user.Id, email: user.Email, username: user.Username },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        console.log("Google login success");

        const loginCode = createLoginCode({
            token,
            user: formatUserResponse(user)
        });
        return redirectToFrontend(res, `/login-success?code=${loginCode}`);

    } catch (error) {
        console.error('Google Login Error:', error.response?.data || error.message);
        return redirectToFrontend(res, '/login?error=google_failed');
    }
};
const getFacebookAuthUrl = (req, res) => {
    const rootUrl = 'https://www.facebook.com/v18.0/dialog/oauth';
    const options = {
        client_id: process.env.FACEBOOK_CLIENT_ID,
        redirect_uri: getFacebookCallbackUrl(),
        state: createOAuthState('facebook'),
        scope: ['email', 'public_profile'].join(','),
        response_type: 'code',
        auth_type: 'rerequest',
    };

    const url = `${rootUrl}?${new URLSearchParams(options).toString()}`;
    res.json({ url });
};

const facebookCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) return redirectToFrontend(res, '/login?error=no_code');

    try {
        validateOAuthState(req, 'facebook');
        const facebookCallbackUrl = getFacebookCallbackUrl();

        const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                client_id: process.env.FACEBOOK_CLIENT_ID,
                client_secret: process.env.FACEBOOK_CLIENT_SECRET,
                redirect_uri: facebookCallbackUrl,
                code,
            }
        });

        const { access_token } = tokenResponse.data;
        const userResponse = await axios.get('https://graph.facebook.com/me', {
            params: {
                fields: 'id,name,email,picture.type(large)',
                access_token,
            }
        });

        const { id: facebookId, name, email, picture } = userResponse.data;
        const avatarUrl = picture?.data?.url;

        let user = await knex('Users').where({ FacebookId: facebookId }).first();

        if (!user) {
            const normalizedEmail = email ? email.toLowerCase() : `${facebookId}@facebook.com`;
            const existingEmailUser = await knex('Users').where({ Email: normalizedEmail }).first();

            if (existingEmailUser) {
                await knex('Users').where({ Id: existingEmailUser.Id }).update({
                    FacebookId: facebookId,
                    AvatarUrl: avatarUrl || existingEmailUser.AvatarUrl
                });
                user = { ...existingEmailUser, FacebookId: facebookId };
            } else {
                const [newUser] = await knex('Users')
                    .insert({
                        Username: name,
                        Email: normalizedEmail,
                        FacebookId: facebookId,
                        AvatarUrl: avatarUrl,
                        badminton_level: 1.00,
                        is_profile_completed: false
                    })
                    .returning('*');
                user = newUser;
            }
        }

        const token = jwt.sign(
            { id: user.Id, email: user.Email, username: user.Username },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        console.log("Facebook login success");

        const loginCode = createLoginCode({
            token,
            user: formatUserResponse(user)
        });
        return redirectToFrontend(res, `/login-success?code=${loginCode}`);
    } catch (error) {
        console.error('Facebook Login Error:', error.response?.data || error.message);
        return redirectToFrontend(res, '/login?error=facebook_failed');
    }
};

const exchangeLoginCode = async (req, res) => {
    const { code } = req.body || {};
    if (!code) {
        return res.status(400).json({ success: false, message: '缺少登入 code' });
    }

    const payload = consumeLoginCode(code);
    if (!payload) {
        return res.status(400).json({ success: false, message: '登入 code 無效或已過期' });
    }

    return res.json({
        success: true,
        token: payload.token,
        user: payload.user
    });
};

const getRankings = async (req, res) => {
    const rawType = String(req.query?.type || 'score').toLowerCase();
    const type = ['score', 'active', 'progress'].includes(rawType) ? rawType : 'score';
    const publicLimit = 10;
    const windowDays = Math.min(90, Math.max(7, Number(req.query?.windowDays || 30)));
    const currentUserId = Number(req.user?.id || 0) || null;
    const NEWBIE_VERIFIED_THRESHOLD = 10;
    const NEWBIE_LEVEL_MAX = 4;
    const MENTOR_LEVEL_GAP = 2;
    const MENTOR_UPSET_BONUS = 12;
    const MENTOR_NORMAL_BONUS = 6;
    const MENTOR_FARM_BONUS = 1;
    const MENTOR_LOSS_SHIELD = 2;
    const MENTOR_UPSET_THRESHOLD = 1;
    const MENTOR_LOSS_SHIELD_MARGIN = 0.5;
    const MENTOR_DAILY_CAP = 20;
    const snapshotDate = getRankingSnapshotDateKey();

    try {
        let cachedSnapshot = null;
        try {
            cachedSnapshot = await knex('RankingSnapshots')
                .where({
                    snapshot_date: snapshotDate,
                    type,
                    window_days: windowDays,
                    public_limit: publicLimit
                })
                .first();
        } catch (snapshotReadError) {
            // 42P01: table does not exist yet (migration not run). Fall back to live compute.
            if (snapshotReadError?.code !== '42P01') {
                console.error('Read ranking snapshot failed:', snapshotReadError.message);
            }
        }

        if (cachedSnapshot?.ranked_all) {
            const visibilityUsers = await knex('Users').select('Id', 'is_ranking_public');
            const visibilityByUserId = buildRankingVisibilityMap(visibilityUsers);
            const cachedAt = dayjs(cachedSnapshot.generated_at);
            const generatedAt = cachedAt.isValid() ? cachedAt.toISOString() : new Date().toISOString();
            return res.json({
                success: true,
                data: buildRankingPayloadForViewer({
                    rankedAll: cachedSnapshot.ranked_all,
                    currentUserId,
                    type,
                    generatedAt,
                    windowDays,
                    publicLimit,
                    visibilityByUserId
                })
            });
        }

        const users = await knex('Users')
            .select('Id', 'Username', 'AvatarUrl', 'badminton_level', 'verified_matches', 'is_ranking_public');
        const visibilityByUserId = buildRankingVisibilityMap(users);

        if (users.length === 0) {
            return res.json({
                success: true,
                data: buildRankingPayloadForViewer({
                    rankedAll: [],
                    currentUserId,
                    type,
                    generatedAt: new Date().toISOString(),
                    windowDays,
                    publicLimit,
                    visibilityByUserId
                })
            });
        }

        const statsByUserId = new Map();
        const userMetaById = new Map();
        const mentorBonusByUserId = new Map();
        for (const user of users) {
            const userId = Number(user.Id);
            const level = Number(user.badminton_level || 1);
            const verifiedMatches = Number(user.verified_matches || 0);
            statsByUserId.set(userId, {
                matches: 0,
                wins: 0,
                losses: 0,
                recentMatches: 0,
                recentWins: 0,
                recentLosses: 0,
                currentWeekMatches: 0,
                currentWeekWins: 0,
                currentWeekLosses: 0,
                prevWeekMatches: 0,
                prevWeekWins: 0,
                prevWeekLosses: 0
            });
            userMetaById.set(userId, { level, verifiedMatches });
            mentorBonusByUserId.set(userId, 0);
        }

        const playerEntries = await knex('GamePlayers')
            .where(function () {
                this.where('IsVirtual', false).orWhereNull('IsVirtual');
            })
            .whereNotNull('UserId')
            .select('Id', 'UserId');

        const entryOwnerMap = new Map();
        for (const row of playerEntries) {
            const entryId = Number(row.Id);
            const userId = Number(row.UserId);
            if (entryId > 0 && userId > 0) {
                entryOwnerMap.set(entryId, userId);
            }
        }

        const finishedMatches = await knex('Matches')
            .where({ match_status: 'finished' })
            .whereIn('winner', ['A', 'B'])
            .select('winner', 'player_a1', 'player_a2', 'player_b1', 'player_b2', 'end_time');

        const recentCutoff = dayjs().subtract(windowDays, 'day');
        const currentWeekCutoff = dayjs().subtract(7, 'day');
        const previousWeekCutoff = dayjs().subtract(14, 'day');
        const mentorDailyUsed = new Map();
        const mentorPairDailyCount = new Map();
        const toTeamAvgLevel = (teamIds) => {
            if (!Array.isArray(teamIds) || teamIds.length === 0) return 0;
            const sum = teamIds.reduce((acc, uid) => acc + Number(userMetaById.get(uid)?.level || 1), 0);
            return sum / teamIds.length;
        };
        const isNewbie = (meta) => {
            if (!meta) return false;
            return Number(meta.verifiedMatches || 0) < NEWBIE_VERIFIED_THRESHOLD || Number(meta.level || 1) <= NEWBIE_LEVEL_MAX;
        };
        const getMentorPair = (teamIds) => {
            if (!Array.isArray(teamIds) || teamIds.length !== 2) return null;
            const [u1, u2] = teamIds;
            const m1 = userMetaById.get(u1);
            const m2 = userMetaById.get(u2);
            if (!m1 || !m2) return null;

            if ((Number(m1.level) - Number(m2.level) >= MENTOR_LEVEL_GAP) && isNewbie(m2)) {
                return { mentorId: u1, newbieId: u2 };
            }
            if ((Number(m2.level) - Number(m1.level) >= MENTOR_LEVEL_GAP) && isNewbie(m1)) {
                return { mentorId: u2, newbieId: u1 };
            }
            return null;
        };
        const applyMentorBonus = ({ mentorId, newbieId, dayKey, baseBonus }) => {
            if (!mentorId || !newbieId || !dayKey || !baseBonus || baseBonus <= 0) return;
            const dailyKey = `${dayKey}|${mentorId}`;
            const usedToday = Number(mentorDailyUsed.get(dailyKey) || 0);
            if (usedToday >= MENTOR_DAILY_CAP) return;

            const pairKey = `${dayKey}|${mentorId}|${newbieId}`;
            const pairCount = Number(mentorPairDailyCount.get(pairKey) || 0);
            const decay = pairCount === 0 ? 1 : (pairCount === 1 ? 0.5 : 0.2);
            let awarded = Number((baseBonus * decay).toFixed(2));
            if (awarded <= 0) return;

            const remain = Number((MENTOR_DAILY_CAP - usedToday).toFixed(2));
            if (awarded > remain) awarded = remain;
            if (awarded <= 0) return;

            mentorDailyUsed.set(dailyKey, Number((usedToday + awarded).toFixed(2)));
            mentorPairDailyCount.set(pairKey, pairCount + 1);
            mentorBonusByUserId.set(mentorId, Number(((mentorBonusByUserId.get(mentorId) || 0) + awarded).toFixed(2)));
        };
        const toUserSet = (entryIds) => {
            const userIds = entryIds
                .map((entryId) => entryOwnerMap.get(Number(entryId)))
                .filter((uid) => Number.isInteger(uid) && uid > 0);
            return [...new Set(userIds)];
        };

        for (const match of finishedMatches) {
            const teamA = toUserSet([match.player_a1, match.player_a2].filter(Boolean));
            const teamB = toUserSet([match.player_b1, match.player_b2].filter(Boolean));
            const participants = [...new Set([...teamA, ...teamB])];
            if (participants.length === 0) continue;

            const winners = match.winner === 'A' ? teamA : teamB;
            const losers = match.winner === 'A' ? teamB : teamA;
            const endAt = match.end_time ? dayjs(match.end_time) : null;
            const isRecent = !!endAt && endAt.isAfter(recentCutoff);
            const isCurrentWeek = !!endAt && endAt.isAfter(currentWeekCutoff);
            const isPreviousWeek = !!endAt && endAt.isAfter(previousWeekCutoff) && endAt.isBefore(currentWeekCutoff);

            for (const userId of participants) {
                const stat = statsByUserId.get(userId);
                if (!stat) continue;
                stat.matches += 1;
                if (isRecent) stat.recentMatches += 1;
                if (isCurrentWeek) stat.currentWeekMatches += 1;
                if (isPreviousWeek) stat.prevWeekMatches += 1;
            }

            for (const userId of winners) {
                const stat = statsByUserId.get(userId);
                if (!stat) continue;
                stat.wins += 1;
                if (isRecent) stat.recentWins += 1;
                if (isCurrentWeek) stat.currentWeekWins += 1;
                if (isPreviousWeek) stat.prevWeekWins += 1;
            }

            for (const userId of losers) {
                const stat = statsByUserId.get(userId);
                if (!stat) continue;
                stat.losses += 1;
                if (isRecent) stat.recentLosses += 1;
                if (isCurrentWeek) stat.currentWeekLosses += 1;
                if (isPreviousWeek) stat.prevWeekLosses += 1;
            }

            if (isRecent && endAt) {
                const avgA = toTeamAvgLevel(teamA);
                const avgB = toTeamAvgLevel(teamB);
                const mentorA = getMentorPair(teamA);
                const mentorB = getMentorPair(teamB);
                const dayKey = endAt.format('YYYY-MM-DD');

                if (match.winner === 'A' && mentorA) {
                    const bonus = avgB >= (avgA + MENTOR_UPSET_THRESHOLD)
                        ? MENTOR_UPSET_BONUS
                        : (avgA >= (avgB + MENTOR_UPSET_THRESHOLD) ? MENTOR_FARM_BONUS : MENTOR_NORMAL_BONUS);
                    applyMentorBonus({ mentorId: mentorA.mentorId, newbieId: mentorA.newbieId, dayKey, baseBonus: bonus });
                }

                if (match.winner === 'B' && mentorB) {
                    const bonus = avgA >= (avgB + MENTOR_UPSET_THRESHOLD)
                        ? MENTOR_UPSET_BONUS
                        : (avgB >= (avgA + MENTOR_UPSET_THRESHOLD) ? MENTOR_FARM_BONUS : MENTOR_NORMAL_BONUS);
                    applyMentorBonus({ mentorId: mentorB.mentorId, newbieId: mentorB.newbieId, dayKey, baseBonus: bonus });
                }

                if (match.winner === 'A' && mentorB && avgA >= (avgB - MENTOR_LOSS_SHIELD_MARGIN)) {
                    applyMentorBonus({
                        mentorId: mentorB.mentorId,
                        newbieId: mentorB.newbieId,
                        dayKey,
                        baseBonus: MENTOR_LOSS_SHIELD
                    });
                }

                if (match.winner === 'B' && mentorA && avgB >= (avgA - MENTOR_LOSS_SHIELD_MARGIN)) {
                    applyMentorBonus({
                        mentorId: mentorA.mentorId,
                        newbieId: mentorA.newbieId,
                        dayKey,
                        baseBonus: MENTOR_LOSS_SHIELD
                    });
                }
            }
        }

        const rows = users.map((user) => {
            const userId = Number(user.Id);
            const stat = statsByUserId.get(userId) || {
                matches: 0,
                wins: 0,
                losses: 0,
                recentMatches: 0,
                recentWins: 0,
                recentLosses: 0,
                currentWeekMatches: 0,
                currentWeekWins: 0,
                currentWeekLosses: 0,
                prevWeekMatches: 0,
                prevWeekWins: 0,
                prevWeekLosses: 0
            };

            const matches = Number(stat.matches || 0);
            const wins = Number(stat.wins || 0);
            const losses = Number(stat.losses || 0);
            const recentMatches = Number(stat.recentMatches || 0);
            const recentWins = Number(stat.recentWins || 0);
            const recentLosses = Number(stat.recentLosses || 0);
            const currentWeekMatches = Number(stat.currentWeekMatches || 0);
            const currentWeekWins = Number(stat.currentWeekWins || 0);
            const currentWeekLosses = Number(stat.currentWeekLosses || 0);
            const prevWeekMatches = Number(stat.prevWeekMatches || 0);
            const prevWeekWins = Number(stat.prevWeekWins || 0);
            const prevWeekLosses = Number(stat.prevWeekLosses || 0);
            const level = Number(user.badminton_level || 1);
            const verifiedMatches = Number(user.verified_matches || 0);
            const mentorBonus = Number(mentorBonusByUserId.get(userId) || 0);
            const winRate = matches > 0 ? Number(((wins / matches) * 100).toFixed(1)) : 0;
            const recentWinRate = recentMatches > 0 ? Number(((recentWins / recentMatches) * 100).toFixed(1)) : 0;
            const currentWeekWinRate = currentWeekMatches > 0 ? Number(((currentWeekWins / currentWeekMatches) * 100).toFixed(1)) : 0;
            const prevWeekWinRate = prevWeekMatches > 0 ? Number(((prevWeekWins / prevWeekMatches) * 100).toFixed(1)) : 0;
            const score = Math.round(level * 100 + wins * 8 + verifiedMatches * 3 + recentMatches * 4 + mentorBonus - losses * 2);
            const activityScore = recentMatches * 12 + recentWins * 4 + Math.round(level * 2);
            const currentWeekScore = currentWeekWins * 12 + currentWeekMatches * 3 - currentWeekLosses * 4;
            const previousWeekScore = prevWeekWins * 12 + prevWeekMatches * 3 - prevWeekLosses * 4;
            const progressScore = currentWeekScore - previousWeekScore;
            const progressWinRateDelta = Number((currentWeekWinRate - prevWeekWinRate).toFixed(1));

            return {
                userId,
                username: user.Username || `Player #${userId}`,
                avatarUrl: buildAvatarAssetUrl(req, userId, user.AvatarUrl),
                isRankingPublic: user.is_ranking_public !== false,
                level: Number(level.toFixed(2)),
                verifiedMatches,
                matches,
                wins,
                losses,
                winRate,
                recentMatches,
                recentWins,
                recentLosses,
                recentWinRate,
                currentWeekMatches,
                currentWeekWins,
                currentWeekLosses,
                prevWeekMatches,
                prevWeekWins,
                prevWeekLosses,
                currentWeekWinRate,
                prevWeekWinRate,
                score,
                mentorBonus,
                activityScore,
                progressScore,
                progressWinRateDelta,
                trend: recentWins - recentLosses,
                currentWeekScore,
                previousWeekScore
            };
        });

        let filtered = rows;
        if (type === 'score') {
            filtered = rows.filter((row) => row.matches > 0 || row.verifiedMatches > 0);
        } else if (type === 'active') {
            filtered = rows.filter((row) => row.recentMatches > 0 || row.matches > 0);
        } else if (type === 'progress') {
            filtered = rows.filter((row) => row.currentWeekMatches > 0 || row.prevWeekMatches > 0);
        }

        if (filtered.length === 0) {
            filtered = rows;
        }

        const currentWeekRankMap = new Map();
        const previousWeekRankMap = new Map();

        const currentWeekSorted = [...filtered].sort((a, b) => (
            b.currentWeekScore - a.currentWeekScore ||
            b.currentWeekWins - a.currentWeekWins ||
            b.currentWeekMatches - a.currentWeekMatches ||
            a.username.localeCompare(b.username)
        ));
        const previousWeekSorted = [...filtered].sort((a, b) => (
            b.previousWeekScore - a.previousWeekScore ||
            b.prevWeekWins - a.prevWeekWins ||
            b.prevWeekMatches - a.prevWeekMatches ||
            a.username.localeCompare(b.username)
        ));

        currentWeekSorted.forEach((row, index) => currentWeekRankMap.set(row.userId, index + 1));
        previousWeekSorted.forEach((row, index) => previousWeekRankMap.set(row.userId, index + 1));

        const sorted = [...filtered].sort((a, b) => {
            if (type === 'score') {
                return (
                    b.score - a.score ||
                    b.winRate - a.winRate ||
                    b.matches - a.matches ||
                    a.username.localeCompare(b.username)
                );
            }
            if (type === 'active') {
                return (
                    b.activityScore - a.activityScore ||
                    b.recentMatches - a.recentMatches ||
                    b.recentWinRate - a.recentWinRate ||
                    b.level - a.level ||
                    a.username.localeCompare(b.username)
                );
            }
            return (
                b.progressScore - a.progressScore ||
                b.currentWeekWins - a.currentWeekWins ||
                b.currentWeekMatches - a.currentWeekMatches ||
                b.progressWinRateDelta - a.progressWinRateDelta ||
                a.username.localeCompare(b.username)
            );
        });

        const rankedAll = sorted.map((row, index) => {
            const currentWeekRank = currentWeekRankMap.get(row.userId) ?? null;
            const previousWeekRank = previousWeekRankMap.get(row.userId) ?? null;
            const weeklyRankDelta = (
                currentWeekRank === null || previousWeekRank === null
                    ? null
                    : previousWeekRank - currentWeekRank
            );
            return {
                ...row,
                rank: index + 1,
                weeklyRankDelta
            };
        });
        const generatedAt = new Date().toISOString();
        const payloadData = buildRankingPayloadForViewer({
            rankedAll,
            currentUserId,
            type,
            generatedAt,
            windowDays,
            publicLimit,
            visibilityByUserId
        });

        try {
            const rankedAllJson = JSON.stringify(rankedAll);
            await knex('RankingSnapshots')
                .insert({
                    snapshot_date: snapshotDate,
                    type,
                    window_days: windowDays,
                    public_limit: publicLimit,
                    generated_at: generatedAt,
                    ranked_all: rankedAllJson
                })
                .onConflict(['snapshot_date', 'type', 'window_days', 'public_limit'])
                .merge({
                    generated_at: generatedAt,
                    ranked_all: rankedAllJson,
                    updated_at: knex.fn.now()
                });
        } catch (snapshotWriteError) {
            // 42P01: table does not exist yet (migration not run). Keep API response available.
            if (snapshotWriteError?.code !== '42P01') {
                console.error('Write ranking snapshot failed:', snapshotWriteError.message);
            }
        }

        return res.json({
            success: true,
            data: payloadData
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to get rankings' });
    }
};
const rating = async (req, res) => {
    const { years, level } = req.body;
    const userId = req.user.id;

    let numericLevel = 1.0;
    const match = level.match(/(\d+)(-(\d+))?/);
    if (match) {
        if (match[3]) {
            numericLevel = (parseFloat(match[1]) + parseFloat(match[3])) / 2;
        } else {
            numericLevel = parseFloat(match[1]);
        }
    }

    try {
        await knex('Users')
            .where({ Id: userId })
            .update({
                experience_years: years,
                badminton_level: numericLevel,
                is_profile_completed: true,
                play_frequency: req.body.frequency || null,
                play_style: req.body.playStyle || null,
            });

        const updatedUser = await knex('Users').where({ Id: userId }).first();

        res.json({
            success: true,
            message: "Profile updated",
            user: updatedUser
        });
    } catch (error) {
        console.error("Update profile failed:", error);
        res.status(500).json({ error: "Failed to update profile" });
    }
};
const getMe = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await knex('Users').where({ Id: userId }).first();

        if (!user) return res.status(404).json({ success: false });

        res.json({
            success: true,
            user: {
                id: user.Id,
                username: user.Username,
                avatarUrl: user.AvatarUrl,
                is_profile_completed: !!user.is_profile_completed,
                badminton_level: user.badminton_level,
                verified_matches: user.verified_matches,
                is_ranking_public: user.is_ranking_public !== false,
            }
        });
    } catch (error) {
        res.status(500).json({ success: false });
    }
};

const updateRankingVisibility = async (req, res) => {
    try {
        const userId = req.user.id;
        const { isPublic } = req.body || {};
        if (typeof isPublic !== 'boolean') {
            return res.status(400).json({ success: false, message: 'isPublic must be boolean' });
        }

        await knex('Users')
            .where({ Id: userId })
            .update({ is_ranking_public: isPublic });

        return res.json({
            success: true,
            message: isPublic ? '已開啟詳細數據公開' : '已隱藏詳細數據（名次仍公開）',
            user: {
                id: userId,
                is_ranking_public: isPublic
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to update ranking visibility' });
    }
};

const getPublicProfile = async (req, res) => {
    try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid user id' });
        }

        const user = await knex('Users')
            .where({ Id: userId })
            .select('Id', 'Username', 'AvatarUrl', 'badminton_level', 'verified_matches')
            .first();

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const entries = await knex('GamePlayers')
            .where({ UserId: userId, IsVirtual: false })
            .whereNot('Status', 'CANCELED')
            .select('Id');

        const playerEntryIds = entries.map((entry) => entry.Id);
        if (playerEntryIds.length === 0) {
        return res.json({
            success: true,
            data: {
                id: user.Id,
                username: user.Username,
                avatarUrl: buildAvatarAssetUrl(req, user.Id, user.AvatarUrl),
                level: Number(user.badminton_level || 1),
                verified_matches: Number(user.verified_matches || 0),
                matches: 0,
                    wins: 0,
                    losses: 0,
                    winRate: 0
                }
            });
        }

        const finishedMatches = await knex('Matches')
            .where('match_status', 'finished')
            .whereIn('winner', ['A', 'B'])
            .where(function () {
                this.whereIn('player_a1', playerEntryIds)
                    .orWhereIn('player_a2', playerEntryIds)
                    .orWhereIn('player_b1', playerEntryIds)
                    .orWhereIn('player_b2', playerEntryIds);
            })
            .select('winner', 'player_a1', 'player_a2', 'player_b1', 'player_b2');

        const playerEntrySet = new Set(playerEntryIds.map((id) => Number(id)));
        let wins = 0;
        let losses = 0;

        for (const match of finishedMatches) {
            const inTeamA =
                playerEntrySet.has(Number(match.player_a1)) ||
                playerEntrySet.has(Number(match.player_a2));
            const inTeamB =
                playerEntrySet.has(Number(match.player_b1)) ||
                playerEntrySet.has(Number(match.player_b2));
            if (!inTeamA && !inTeamB) continue;

            if ((inTeamA && match.winner === 'A') || (inTeamB && match.winner === 'B')) {
                wins += 1;
            } else {
                losses += 1;
            }
        }

        const matches = wins + losses;
        const winRate = matches > 0 ? Number(((wins / matches) * 100).toFixed(1)) : 0;

        return res.json({
            success: true,
            data: {
                id: user.Id,
                username: user.Username,
                avatarUrl: buildAvatarAssetUrl(req, user.Id, user.AvatarUrl),
                level: Number(user.badminton_level || 1),
                verified_matches: Number(user.verified_matches || 0),
                matches,
                wins,
                losses,
                winRate
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to get public profile' });
    }
};

const getAvatarById = async (req, res) => {
    try {
        const userId = Number(req.params.id);
        if (!Number.isInteger(userId) || userId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid user id' });
        }

        const user = await knex('Users')
            .where({ Id: userId })
            .select('AvatarUrl')
            .first();

        if (!user || !user.AvatarUrl) {
            return res.status(404).json({ success: false, message: 'Avatar not found' });
        }

        const avatar = user.AvatarUrl;
        if (!avatar.startsWith('data:image/')) {
            return res.redirect(302, avatar);
        }

        const matched = avatar.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (!matched) {
            return res.status(400).json({ success: false, message: 'Invalid avatar format' });
        }

        const mimeType = matched[1];
        const base64Data = matched[2];
        const buffer = Buffer.from(base64Data, 'base64');

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.send(buffer);
    } catch (_) {
        return res.status(500).json({ success: false, message: 'Failed to get avatar' });
    }
};

const updateAvatar = async (req, res) => {
    try {
        const userId = req.user.id;
        const { avatarDataUrl } = req.body;

        if (!avatarDataUrl || typeof avatarDataUrl !== 'string') {
            return res.status(400).json({ success: false, message: 'avatarDataUrl is required' });
        }

        const isDataImage = /^data:image\/(png|jpeg|jpg|webp);base64,/.test(avatarDataUrl);
        if (!isDataImage) {
            return res.status(400).json({ success: false, message: 'Avatar must be PNG/JPG/WEBP data URL' });
        }

        if (avatarDataUrl.length > 800000) {
            return res.status(400).json({ success: false, message: 'Avatar is too large' });
        }

        await knex('Users')
            .where({ Id: userId })
            .update({ AvatarUrl: avatarDataUrl });

        const user = await knex('Users').where({ Id: userId }).first();
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        return res.json({
            success: true,
            message: 'Avatar updated',
            user: {
                id: user.Id,
                username: user.Username,
                avatarUrl: user.AvatarUrl,
                is_profile_completed: !!user.is_profile_completed,
                badminton_level: user.badminton_level,
                verified_matches: user.verified_matches,
                is_ranking_public: user.is_ranking_public !== false,
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to update avatar' });
    }
};

module.exports = {
    createUser,
    loginUser,
    logoutUser,
    getLineAuthUrl,
    lineCallback,
    liffLogin,
    rating,
    getMe,
    getPublicProfile,
    getAvatarById,
    updateAvatar,
    googleCallback,
    getGoogleAuthUrl,
    facebookCallback,
    getFacebookAuthUrl,
    exchangeLoginCode,
    getRankings,
    updateRankingVisibility
};
