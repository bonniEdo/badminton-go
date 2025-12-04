const knex = require('../db');


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
        if (!password) {
            console.warn('缺少密碼');
            return res.status(400).json({
                success: false,
                message: '缺少密碼'
            })
        }
        const [newUser] = await knex('Users')
            .insert({
                Username: username,
                Email: email,
                Password: password,
            })
            .returning('*')
        res.status(201).json({
            success: true,
            message: '註冊成功',
            user: newUser
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


module.exports = { createUser };
