const express = require('express');
const router = express.Router();
const { createGame, deleteGame, joinGame, cancelJoin } = require('../controllers/game')
const verifyToken = require('../middlewares/auth');





router.post('/create', verifyToken, createGame);

router.delete('/delete/:id', verifyToken, deleteGame);

router.post('/:id/join', verifyToken, joinGame);

router.delete('/:id/join', verifyToken, cancelJoin);


module.exports = router
