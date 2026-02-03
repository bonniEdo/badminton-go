require('dotenv').config();
const express = require('express');
const knex = require('./db');
const app = express();
const PORT = process.env.PORT || 3000;
const gameRoutes = require('./routes/gameRoutes');
const userRoutes = require('./routes/userRoutes');
const matchRoutes = require('./routes/matchRoutes');
const errorHandler = require('./middlewares/error');
const AppError = require('./utils/appError');
const cors = require('cors');


app.use(cors({
    origin: ['http://localhost:3001', process.env.FRONTEND_URL],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/games', gameRoutes);
app.use('/api/user', userRoutes);
app.use('/api/match', matchRoutes);
app.get('/', (req, res) => {
    res.send('🏸 羽球中毒勒戒所後端總部：運作中');
});

app.use((req, res, next) => {
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
module.exports = app;
