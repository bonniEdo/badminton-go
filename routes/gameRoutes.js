const express = require('express');
const router = express.Router();
const { createGame, getGame, getAllGames, deleteGame, joinGame, getJoinedGames, cancelJoin, playerList, addFriend } = require('../controllers/game')
const verifyToken = require('../middlewares/auth');





router.post('/create', verifyToken, createGame);
router.get('/mygame', verifyToken, getGame);

router.get('/activegames', verifyToken, getAllGames);


router.delete('/delete/:id', verifyToken, deleteGame);

router.post('/:id/join', verifyToken, joinGame);
router.get('/:id/players', verifyToken, playerList);

router.get('/joined', verifyToken, getJoinedGames)
router.delete('/:id/join', verifyToken, cancelJoin);
router.post('/:id/add-friend', verifyToken, addFriend);



module.exports = router
