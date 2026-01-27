require('dotenv').config();

const knex = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const AppError = require('../utils/appError');
const validator = require('validator');
const axios = require('axios');
const crypto = require('crypto');

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
        })
        .returning('*');

    res.status(201).json({
        success: true,
        message: '註冊成功',
        user: { id: newUser.Id, username: newUser.Username, email: newUser.Email }
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
        { expiresIn: '3min' }
    );
    console.log("使用帳密登入成功")

    res.json({
        success: true,
        message: '登入成功',
        token,
        user: { id: user.Id, username: user.Username }

    });

};

// 修正：登出不應該 throw Error
const logoutUser = async (req, res) => {
    res.status(200).json({
        success: true,
        message: '已成功登出，勒戒所隨時歡迎您回來'
    });
};

const getLineAuthUrl = (req, res) => {
    // 產生一個隨機的暗號
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
        // 1. 換取 Token
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
                        Password: null
                    })
                    .returning('*');
                user = newUser;
            }
        }

        const token = jwt.sign(
            { id: user.Id, email: user.Email, username: user.Username, avatarUrl: user.AvatarUrl },
            JWT_SECRET,
            { expiresIn: '3min' }
        );
        console.log("使用LINE登入成功")

        res.redirect(`${process.env.FRONTEND_URL}/login-success?token=${token}`);

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
            { expiresIn: '3min' }
        );

        res.json({ success: true, token, user: { id: user.Id, username: user.Username, avatarUrl: user.AvatarUrl } });
    } catch (error) {
        res.status(401).json({ success: false, message: '身份驗證失敗' });
    }
};
module.exports = { createUser, loginUser, logoutUser, getLineAuthUrl, lineCallback, liffLogin };