const express = require('express');
const router = express.Router();
const { checkin, startMatch, getLiveStatus, finishMatch, getMyHistory } = require('../controllers/match');
const verifyToken = require('../middlewares/auth');


router.post('/checkin', verifyToken, checkin);

router.post('/start', verifyToken, startMatch);
router.get('/live-status/:gameId', verifyToken, getLiveStatus);
router.post('/finish', verifyToken, finishMatch);
router.get('/my-history', verifyToken, getMyHistory);

module.exports = router;