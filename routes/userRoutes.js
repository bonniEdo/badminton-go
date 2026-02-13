const express = require('express');
const router = express.Router();
const { createUser, loginUser, getLineAuthUrl, lineCallback, liffLogin, rating, getMe } = require('../controllers/user')
const verifyToken = require('../middlewares/auth');


router.post('/create', createUser);

router.post('/login', loginUser);
router.get('/line-auth', getLineAuthUrl);
router.get('/line/callback', lineCallback);
router.post('/liff-login', liffLogin);
router.post('/complete-rating', verifyToken, rating);
router.get('/me', verifyToken, getMe);



module.exports = router
