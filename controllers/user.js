require('dotenv').config();

const knex = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const AppError = require('../utils/appError');
const validator = require('validator');
const axios = require('axios');
const crypto = require('crypto');

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
    if (!username) throw new AppError('缺少名字', 400);

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail || !validator.isEmail(normalizedEmail)) {
        throw new AppError('請輸入正確的信箱格式', 400);
    }

    const existingUser = await knex('Users').where({ Email: normalizedEmail }).first();
    if (existingUser) throw new AppError('此信箱已被註冊', 400);

    if (!password) throw new AppError('缺少密碼', 400);

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
        message: '註冊成功',
        user: formatUserResponse(newUser)
    });
};

const loginUser = async (req, res) => {
    const { email, password } = req.body;
    const user = await knex('Users').where({ Email: email.toLowerCase().trim() }).first();

    if (!user || !user.Password) {
        throw new AppError('帳號不存在或請使用 LINE 登入', 401);
    }

    const isMatch = await bcrypt.compare(password, user.Password);
    if (!isMatch) throw new AppError('密碼錯誤', 401);

    const token = jwt.sign(
        { id: user.Id, email: user.Email, username: user.Username },
        JWT_SECRET,
        { expiresIn: '30min' }
    );
    console.log("使用帳密登入成功")

    res.json({
        success: true,
        message: '入所成功',
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
        message: '已離所登記，勒戒所隨時歡迎您回來'
    });
};

const getLineAuthUrl = (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
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
        const lineUser = jwt.decode(id_token);
        const { sub: lineId, name, picture, email } = lineUser;

        let user = await knex('Users').where({ LineId: lineId }).first();

        if (!user) {
            if (email) {
                const existingEmailUser = await knex('Users').where({ Email: email.toLowerCase() }).first();
                if (existingEmailUser) {
                    await knex('Users').where({ Id: existingEmailUser.Id }).update({
                        LineId: lineId,
                        AvatarUrl: picture || existingEmailUser.AvatarUrl
                    });
                    user = { ...existingEmailUser, LineId: lineId };
                }
            }

            if (!user) {
                const [newUser] = await knex('Users')
                    .insert({
                        Username: name,
                        Email: email ? email.toLowerCase() : `${lineId}@line.com`,
                        LineId: lineId,
                        AvatarUrl: picture,
                        badminton_level: 1.00,
                        is_profile_completed: false
                    })
                    .returning('*');
                user = newUser;
            }
        }

        const token = jwt.sign(
            { id: user.Id, email: user.Email, username: user.Username, avatarUrl: user.AvatarUrl },
            JWT_SECRET,
            { expiresIn: '30d' }
        );
        console.log("使用LINE登入成功")

        res.redirect(`${process.env.FRONTEND_URL}/login-success?token=${token}&is_profile_completed=${!!user.is_profile_completed}`);

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
            { id: user.Id, email: user.Email, username: user.Username, avatarUrl: user.AvatarUrl },
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
        res.status(401).json({ success: false, message: '入所身份驗證失敗' });
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
        state: crypto.randomBytes(16).toString('hex'),
    };

    const url = `${rootUrl}?${new URLSearchParams(options).toString()}`;
    res.json({ url });
};

const googleCallback = async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);

    try {
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
                // 完全新用戶，建立帳號
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
            { id: user.Id, email: user.Email, username: user.Username, avatarUrl: user.AvatarUrl },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        console.log("使用 Google 登入成功");

        res.redirect(`${process.env.FRONTEND_URL}/login-success?token=${token}&is_profile_completed=${!!user.is_profile_completed}`);

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
        state: crypto.randomBytes(16).toString('hex'),
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
        { id: user.Id, email: user.Email, username: user.Username, avatarUrl: user.AvatarUrl },
        JWT_SECRET,
        { expiresIn: '30d' }
    );

    console.log("使用 Facebook 登入成功");

    res.redirect(`${process.env.FRONTEND_URL}/login-success?token=${token}&is_profile_completed=${!!user.is_profile_completed}`);

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
            message: "診斷完畢，成癮指數已紀錄",
            user: updatedUser
        });
    } catch (error) {
        console.error("更新評量失敗:", error);
        res.status(500).json({ error: "系統無法紀錄您的診斷結果" });
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

module.exports = {
    createUser, loginUser, logoutUser, getLineAuthUrl, lineCallback, liffLogin, rating, getMe, googleCallback, getGoogleAuthUrl, facebookCallback, getFacebookAuthUrl
};