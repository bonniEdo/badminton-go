require('dotenv').config();
const http = require('http');
const express = require('express');
const knex = require('./db');
const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const { version } = require('./package.json');
const gameRoutes = require('./routes/gameRoutes');
const userRoutes = require('./routes/userRoutes');
const matchRoutes = require('./routes/matchRoutes');
const errorHandler = require('./middlewares/error');
const AppError = require('./utils/appError');
const cors = require('cors');
const { initWebSocket } = require('./wsServer');

app.use(cors({
    origin: ['http://localhost:3001', process.env.FRONTEND_URL],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use('/api/games', gameRoutes);
app.use('/api/user', userRoutes);
app.use('/api/match', matchRoutes);

app.get('/', (req, res) => {
    res.send('Badminton-go API is running');
});

app.get('/version', (req, res) => {
    res.json({
        success: true,
        service: 'badminton-go',
        version
    });
});

app.use((req, res, next) => {
    next(new AppError(`Route not found: ${req.originalUrl}`, 404));
});

app.use(errorHandler);

async function startServer() {
    try {
        await knex.raw('SELECT 1');
        console.log('-------------db connected successfully-------------');

        initWebSocket(server);
        server.listen(PORT, () => {
            console.log(`Server started at http://localhost:${PORT}`);
        });
    } catch (err) {
        console.log('-------------db connection failed-------------', err);
    }
}

startServer();
module.exports = app;
