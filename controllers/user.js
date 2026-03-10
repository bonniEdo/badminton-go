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

    try {
        const users = await knex('Users')
            .select('Id', 'Username', 'AvatarUrl', 'badminton_level', 'verified_matches', 'is_ranking_public');

        if (users.length === 0) {
            return res.json({
                success: true,
                data: {
                    type,
                    generatedAt: new Date().toISOString(),
                    leaderboard: [],
                    podium: [],
                    aroundMe: [],
                    myRank: null,
                    myVisibility: true,
                    total: 0,
                    totalAll: 0,
                    windowDays,
                    publicLimit
                }
            });
        }

        const statsByUserId = new Map();
        for (const user of users) {
            statsByUserId.set(Number(user.Id), {
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
            const winRate = matches > 0 ? Number(((wins / matches) * 100).toFixed(1)) : 0;
            const recentWinRate = recentMatches > 0 ? Number(((recentWins / recentMatches) * 100).toFixed(1)) : 0;
            const currentWeekWinRate = currentWeekMatches > 0 ? Number(((currentWeekWins / currentWeekMatches) * 100).toFixed(1)) : 0;
            const prevWeekWinRate = prevWeekMatches > 0 ? Number(((prevWeekWins / prevWeekMatches) * 100).toFixed(1)) : 0;
            const score = Math.round(level * 100 + wins * 8 + verifiedMatches * 3 + recentMatches * 4 - losses * 2);
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
                activityScore,
                progressScore,
                progressWinRateDelta,
                trend: recentWins - recentLosses
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

        const rankedAll = sorted.map((row, index) => ({ ...row, rank: index + 1 }));
        const myRank = currentUserId ? rankedAll.find((row) => row.userId === currentUserId) || null : null;
        const myVisibility = myRank ? !!myRank.isRankingPublic : true;
        const maskRowForViewer = (row) => {
            const isSelf = !!currentUserId && Number(row.userId) === Number(currentUserId);
            const canViewDetail = isSelf || row.isRankingPublic;
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
                activityScore: null,
                progressScore: null,
                progressWinRateDelta: null,
                trend: null,
            };
        };

        const leaderboard = rankedAll.slice(0, publicLimit).map(maskRowForViewer);
        const podium = rankedAll.slice(0, 3).map(maskRowForViewer);

        const aroundMe = myRank
            ? rankedAll
                .slice(Math.max(0, myRank.rank - 3), Math.min(rankedAll.length, myRank.rank + 2))
                .map(maskRowForViewer)
            : [];

        return res.json({
            success: true,
            data: {
                type,
                generatedAt: new Date().toISOString(),
                leaderboard,
                podium,
                aroundMe,
                myRank,
                myVisibility,
                total: rankedAll.length,
                totalAll: rankedAll.length,
                windowDays,
                publicLimit
            }
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
