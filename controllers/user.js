require('dotenv').config();

const knex = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const createUser = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username) {
            console.warn('缺少名字');
            return res.status(400).json({
                success: false,
                message: '缺少名字'
            })
        }
        if (!email) {
            console.warn('缺少信箱');
            return res.status(400).json({
                success: false,
                message: '缺少信箱'
            })
        }
        const existingUser = await knex('Users').where({ Email: email }).first();
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: '此信箱已被註冊'
            });
        }

        if (!password) {
            console.warn('缺少密碼');
            return res.status(400).json({
                success: false,
                message: '缺少密碼'
            })
        }
        const hashedPassword = await bcrypt.hash(password, 10);

        const [newUser] = await knex('Users')
            .insert({
                Username: username,
                Email: email,
                Password: hashedPassword,
            })
            .returning('*')
        res.status(201).json({
            success: true,
            message: '註冊成功',
            user: {
                id: newUser.Id,
                username: newUser.Username,
                email: newUser.Email
            }
        });
        console.log('新使用者註冊成功')

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: '意外錯誤，註冊失敗歐'
        })
    }
};




const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await knex('Users').where({ Email: email }).first();

        if (!user) {
            return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
        }

        const isMatch = await bcrypt.compare(password, user.Password);

        if (!isMatch) {
            return res.status(401).json({ success: false, message: '帳號或密碼錯誤' });
        }


        const token = jwt.sign(
            { id: user.Id, email: user.Email, username: user.Username },
            JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.json({
            success: true,
            message: '登入成功',
            token: token,
            user: { id: user.Id, username: user.Username }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: '伺服器錯誤' });
    }
};



module.exports = { createUser, loginUser };
