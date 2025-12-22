require('dotenv').config();

const knex = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
const AppError = require('../utils/appError');
const validator = require('validator');



const createUser = async (req, res) => {
    const { username, email, password } = req.body;
    if (!username) {
        throw new AppError('缺少名字', 400);
    }
    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail || !validator.isEmail(normalizedEmail)) {
        throw new AppError('請輸入正確的信箱格式', 400);
    }
    const existingUser = await knex('Users').where({ Email: email }).first();
    if (existingUser) {
        throw new AppError('此信箱已被註冊', 400);
    }
    if (!password) {
        throw new AppError('缺少密碼', 400);
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


};




const loginUser = async (req, res) => {

    const { email, password } = req.body;

    const user = await knex('Users').where({ Email: email }).first();

    if (!user) {
        throw new AppError('帳號錯誤');
    }

    const isMatch = await bcrypt.compare(password, user.Password);

    if (!isMatch) {
        throw new AppError('密碼錯誤');
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

};


const logoutUser = async (req, res) => {
    throw new AppError('已成功登出')
};



module.exports = { createUser, loginUser, logoutUser };
