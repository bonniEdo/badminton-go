const { WebSocketServer } = require('ws');

// gameId → Set<ws>
const gameRooms = new Map();

let wss = null;

function initWebSocket(httpServer) {
    wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    wss.on('connection', (ws) => {
        ws._gameId = null;

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.type === 'join' && msg.gameId) {
                    if (ws._gameId) leaveRoom(ws);
                    ws._gameId = String(msg.gameId);
                    if (!gameRooms.has(ws._gameId)) gameRooms.set(ws._gameId, new Set());
                    gameRooms.get(ws._gameId).add(ws);
                }
            } catch (_) {}
        });

        ws.on('close', () => leaveRoom(ws));
    });

    console.log('🔌 WebSocket server ready on /ws');
}

function leaveRoom(ws) {
    if (!ws._gameId) return;
    const room = gameRooms.get(ws._gameId);
    if (room) {
        room.delete(ws);
        if (room.size === 0) gameRooms.delete(ws._gameId);
    }
    ws._gameId = null;
}

function broadcastToGame(gameId) {
    const room = gameRooms.get(String(gameId));
    if (!room) return;
    const payload = JSON.stringify({ type: 'refresh' });
    for (const ws of room) {
        if (ws.readyState === 1) ws.send(payload);
    }
}

module.exports = { initWebSocket, broadcastToGame };
