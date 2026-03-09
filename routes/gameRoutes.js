const express = require('express');
const router = express.Router();
const { createGame, updateGame, getGame, getAllGames, deleteGame, joinGame, getJoinedGames, cancelJoin, playerList, addFriend, getGameById, markPaid } = require('../controllers/game')
const verifyToken = require('../middlewares/auth');
const optionalAuth = require('../middlewares/optionalAuth');



router.post('/create', verifyToken, createGame);
router.put('/:id', verifyToken, updateGame);
router.get('/mygame', verifyToken, getGame);

router.get('/activegames', optionalAuth, getAllGames);


router.delete('/delete/:id', verifyToken, deleteGame);

router.post('/:id/join', verifyToken, joinGame);
router.get('/:id/players', optionalAuth, playerList);

router.get('/joined', verifyToken, getJoinedGames)
router.delete('/:id/join', verifyToken, cancelJoin);
router.post('/:id/add-friend', verifyToken, addFriend);
router.post('/:id/mark-paid', verifyToken, markPaid);
router.get('/:id', verifyToken, getGameById)




module.exports = router
