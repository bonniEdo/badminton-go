const crypto = require('crypto');

const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map();

const createOAuthState = (provider) => {
    const state = crypto.randomBytes(16).toString('hex');
    stateStore.set(state, {
        provider,
        expiresAt: Date.now() + STATE_TTL_MS
    });
    return state;
};

const consumeOAuthState = (provider, state) => {
    if (!state) return false;
    const row = stateStore.get(state);
    if (!row) return false;
    stateStore.delete(state);
    if (Date.now() > row.expiresAt) return false;
    return row.provider === provider;
};

module.exports = {
    createOAuthState,
    consumeOAuthState
};
