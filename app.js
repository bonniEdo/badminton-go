const express = require('express');
const knex = require('./db');
const app = express();
const PORT = 3000;
const gameRoutes = require('./routes/gameRoutes');
const userRoutes = require('./routes/userRoutes');
const errorHandler = require('./middlewares/error');
const AppError = require('./utils/appError');
const cors = require('cors');


app.use(cors({
  origin: ['https://webapub.run.place', 'http://localhost:3001'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());
app.use('/api/games', gameRoutes);
app.use('/api/user', userRoutes);

app.use((req, res, next) => {
    // 使用 next 傳遞錯誤，並修正大小寫
    next(new AppError(`找不到路徑 ${req.originalUrl}`, 404));
});

app.use(errorHandler);

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