const express = require('express');
const knex = require('./db');
const app = express();
const PORT = 3000;
const gameRoutes = require('./routes/gameRoutes');

app.use(express.json());


app.use('/api/games', gameRoutes)

async function startServer() {
    try {
        await knex.raw('SELECT 1');
        console.log('-------------db connected successfully-------------');

        app.listen(PORT, () => {
            console.log(`🏸 羽球系統啟動中：http://localhost:${PORT}`);
        });
    } catch (err) {
        console.log('-------------db connection failed-------------', err);
    };

}

startServer();