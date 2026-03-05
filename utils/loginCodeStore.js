const crypto = require('crypto');

const STORE_TTL_MS = 2 * 60 * 1000;
const loginCodeStore = new Map();

const createLoginCode = (payload) => {
    const code = crypto.randomBytes(24).toString('hex');
    loginCodeStore.set(code, {
        payload,
        expiresAt: Date.now() + STORE_TTL_MS
    });
    return code;
};

const consumeLoginCode = (code) => {
    const row = loginCodeStore.get(code);
    if (!row) return null;
    loginCodeStore.delete(code);
    if (Date.now() > row.expiresAt) return null;
    return row.payload;
};

module.exports = {
    createLoginCode,
    consumeLoginCode
};
