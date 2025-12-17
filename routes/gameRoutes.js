const express = require('express');
const router = express.Router();
const { createGame, getGame, getAllGames, deleteGame, joinGame, getJoinedGames, cancelJoin } = require('../controllers/game')
const verifyToken = require('../middlewares/auth');





router.post('/create', verifyToken, createGame);
router.get('/mygame', verifyToken, getGame);

router.get('/activegames', getAllGames);


router.delete('/delete/:id', verifyToken, deleteGame);

router.post('/:id/join', verifyToken, joinGame);

router.get('/joined', verifyToken, getJoinedGames)
router.delete('/:id/join', verifyToken, cancelJoin);


module.exports = router
