require('dotenv').config();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.warn('未提供 Token 或格式錯誤');
        return res.status(401).json({
            success: false,
            message: '未提供 Token 或格式錯誤，請先登入'
        });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();

    } catch (error) {
        console.error('Token 驗證失敗:', error.message);
        return res.status(403).json({
            success: false,
            message: 'Token 無效或已過期，請重新登入'
        });
    }

};




module.exports = verifyToken;