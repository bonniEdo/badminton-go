const dayjs = require('dayjs');


const GameStatus = (data) => {
    const now = dayjs();

    const processGame = (game) => {
        if (!game.GameDateTime) return game;

        const isExpired = dayjs(game.GameDateTime).isBefore(now);

        return {
            ...game,
            isExpired: isExpired
        };
    };

    return Array.isArray(data) ? data.map(processGame) : processGame(data);
};

module.exports = { GameStatus };