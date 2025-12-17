const express = require('express');
const knex = require('./db');
const app = express();
const PORT = 8080;
const gameRoutes = require('./routes/gameRoutes');
const userRoutes = require('./routes/userRoutes');
const cors = require('cors');


// 2. 設定 CORS (這段要放在所有路由之前！)
app.use(cors({
    origin: 'http://localhost:3000',  // 只允許你的 Next.js 前端連線
    credentials: true,                // 允許帶 Cookie (如果有用到的話)
    allowedHeaders: ['Content-Type', 'Authorization'] // 關鍵！允許 Bearer Token
}));

app.use(express.json());
app.use('/api/games', gameRoutes);
app.use('/api/user', userRoutes);

async function startServer() {
    try {
        await knex.raw('SELECT 1');
        console.log('-------------db connected successfully-------------');

        app.listen(PORT, () => {
            console.log(`🏸 羽球後端系統啟動中：http://localhost:${PORT}`);
        });
    } catch (err) {
        console.log('-------------db connection failed-------------', err);
    };
}

startServer();