const express = require('express');
const router = express.Router();
const { createGame, deleteGame } = require('../controllers/game')
const verifyToken = require('../middlewares/auth');





router.post('/create', verifyToken, createGame);

router.delete('/delete/:id', verifyToken, deleteGame);


module.exports = router
