const express = require('express');
const knex = require('./db');
const app = express();
const PORT = 3000;
const gameRoutes = require('./routes/gameRoutes');
const userRoutes = require('./routes/userRoutes');
const errorHandler = require('./middlewares/error');
const AppError = require('./utils/appError');
const cors = require('cors');




app.use(express.json());
app.use('/api/games', gameRoutes);
app.use('/api/user', userRoutes);
app.all('*', (req, res, next) => {
    throw new appError(`找不到路徑 ${req.originalUrl}`, 404);
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