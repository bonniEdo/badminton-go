const express = require('express');
const router = express.Router();
const { createUser, loginUser, getLineAuthUrl, lineCallback, liffLogin, rating, getMe, updateAvatar, googleCallback, getGoogleAuthUrl, facebookCallback, getFacebookAuthUrl } = require('../controllers/user')
const verifyToken = require('../middlewares/auth');


router.post('/create', createUser);

router.post('/login', loginUser);
router.get('/line-auth', getLineAuthUrl);
router.get('/line/callback', lineCallback);
router.get('/google-auth', getGoogleAuthUrl);
router.get('/google/callback', googleCallback);
router.get('/facebook-auth', getFacebookAuthUrl);
router.get('/facebook/callback', facebookCallback);
router.post('/liff-login', liffLogin);
router.post('/complete-rating', verifyToken, rating);
router.get('/me', verifyToken, getMe);
router.post('/avatar', verifyToken, updateAvatar);



module.exports = router
