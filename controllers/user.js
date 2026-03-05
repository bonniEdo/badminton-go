require('dotenv').config();

const knex = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const AppError = require('../utils/appError');
const validator = require('validator');
const axios = require('axios');
const { createLoginCode, consumeLoginCode } = require('../utils/loginCodeStore');
const { createOAuthState, consumeOAuthState } = require('../utils/oauthStateStore');

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
});

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
    const redirect_uri = encodeURIComponent(process.env.LINE_CALLBACK_URL);
    const scope = 'profile openid email';

    const url = `https://access.line.me/oauth2/v2.1/authorize?response_type=code&client_id=${client_id}&redirect_uri=${redirect_uri}&state=${state}&scope=${scope}`;
    res.json({ url });
};

const lineCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);

    try {
        validateOAuthState(req, 'line');
        const tokenResponse = await axios.post('https://api.line.me/oauth2/v2.1/token',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.LINE_CALLBACK_URL,
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
        res.redirect(`${process.env.FRONTEND_URL}/login-success?code=${loginCode}`);

    } catch (error) {
        console.error('LINE Login Error:', error.response?.data || error.message);
        res.redirect(`${process.env.FRONTEND_URL}/login?error=line_failed`);
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
            }
        });
    } catch (error) {
        res.status(401).json({ success: false, message: 'LIFF login failed' });
    }
};
const getGoogleAuthUrl = (req, res) => {
    const rootUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const options = {
        redirect_uri: process.env.GOOGLE_CALLBACK_URL,
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
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);

    try {
        validateOAuthState(req, 'google');
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            code,
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            redirect_uri: process.env.GOOGLE_CALLBACK_URL,
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
        res.redirect(`${process.env.FRONTEND_URL}/login-success?code=${loginCode}`);

    } catch (error) {
        console.error('Google Login Error:', error.response?.data || error.message);
        res.redirect(`${process.env.FRONTEND_URL}/login?error=google_failed`);
    }
};
const getFacebookAuthUrl = (req, res) => {
    const rootUrl = 'https://www.facebook.com/v18.0/dialog/oauth';
    const options = {
        client_id: process.env.FACEBOOK_CLIENT_ID,
        redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
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
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);

    try {
        validateOAuthState(req, 'facebook');

        const tokenResponse = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
            params: {
                client_id: process.env.FACEBOOK_CLIENT_ID,
                client_secret: process.env.FACEBOOK_CLIENT_SECRET,
                redirect_uri: process.env.FACEBOOK_CALLBACK_URL,
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
        res.redirect(`${process.env.FRONTEND_URL}/login-success?code=${loginCode}`);
    } catch (error) {
        console.error('Facebook Login Error:', error.response?.data || error.message);
        res.redirect(`${process.env.FRONTEND_URL}/login?error=facebook_failed`);
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
            }
        });
    } catch (error) {
        res.status(500).json({ success: false });
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
                    avatarUrl: user.AvatarUrl || null,
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
                avatarUrl: user.AvatarUrl || null,
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
    updateAvatar,
    googleCallback,
    getGoogleAuthUrl,
    facebookCallback,
    getFacebookAuthUrl,
    exchangeLoginCode
};




