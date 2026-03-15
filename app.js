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
const { refreshRankingSnapshotsInBackground } = require('./controllers/user');
const errorHandler = require('./middlewares/error');
const AppError = require('./utils/appError');
const cors = require('cors');
const { initWebSocket } = require('./wsServer');
const RANKING_SNAPSHOT_REFRESH_MINUTES = Math.max(
    1,
    Number(process.env.RANKING_SNAPSHOT_REFRESH_MINUTES || 10)
);
const RANKING_SNAPSHOT_DEFAULT_WINDOW_DAYS = Math.min(
    90,
    Math.max(7, Number(process.env.RANKING_SNAPSHOT_DEFAULT_WINDOW_DAYS || 30))
);
const RANKING_SNAPSHOT_ORIGIN = String(
    process.env.RANKING_SNAPSHOT_ORIGIN || `http://localhost:${PORT}`
).trim();

app.use(cors({
    origin: ['http://localhost:3001', process.env.FRONTEND_URL],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

const startRankingSnapshotScheduler = () => {
    let isRefreshing = false;

    const runRefresh = async (trigger) => {
        if (isRefreshing) {
            console.log(`[RankingSnapshot] ${trigger} skipped: previous refresh is still running`);
            return;
        }
        isRefreshing = true;
        const startedAt = Date.now();

        try {
            const result = await refreshRankingSnapshotsInBackground({
                origin: RANKING_SNAPSHOT_ORIGIN,
                windowDays: RANKING_SNAPSHOT_DEFAULT_WINDOW_DAYS
            });
            const durationMs = Date.now() - startedAt;
            console.log(
                `[RankingSnapshot] ${trigger} refresh completed in ${durationMs}ms (${result.successCount}/${result.totalCount})`
            );
        } catch (error) {
            console.error(`[RankingSnapshot] ${trigger} refresh failed:`, error.message);
        } finally {
            isRefreshing = false;
        }
    };

    console.log(
        `[RankingSnapshot] scheduler started: every ${RANKING_SNAPSHOT_REFRESH_MINUTES} minute(s), origin=${RANKING_SNAPSHOT_ORIGIN}, windowDays=${RANKING_SNAPSHOT_DEFAULT_WINDOW_DAYS}`
    );

    void runRefresh('startup');
    setInterval(() => {
        void runRefresh('interval');
    }, RANKING_SNAPSHOT_REFRESH_MINUTES * 60 * 1000);
};

async function startServer() {
    try {
        await knex.raw('SELECT 1');
        console.log('-------------db connected successfully-------------');

        initWebSocket(server);
        server.listen(PORT, () => {
            console.log(`Server started at http://localhost:${PORT}`);
            startRankingSnapshotScheduler();
        });
    } catch (err) {
        console.log('-------------db connection failed-------------', err);
    }
}

startServer();
module.exports = app;
