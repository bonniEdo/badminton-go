const express = require('express');
const router = express.Router();
const {
  createUser,
  loginUser,
  getLineAuthUrl,
  lineCallback,
  liffLogin,
  rating,
  getMe,
  getPublicProfile,
  getAvatarById,
  updateAvatar,
  googleCallback,
  getGoogleAuthUrl,
  facebookCallback,
  getFacebookAuthUrl,
  exchangeLoginCode
} = require('../controllers/user')
const verifyToken = require('../middlewares/auth');


router.post('/create', createUser);

router.post('/login', loginUser);
router.post('/exchange-login-code', exchangeLoginCode);
router.get('/line-auth', getLineAuthUrl);
router.get('/line/callback', lineCallback);
router.get('/google-auth', getGoogleAuthUrl);
router.get('/google/callback', googleCallback);
router.get('/facebook-auth', getFacebookAuthUrl);
router.get('/facebook/callback', facebookCallback);
router.post('/liff-login', liffLogin);
router.post('/complete-rating', verifyToken, rating);
router.get('/me', verifyToken, getMe);
router.get('/public/:id', getPublicProfile);
router.get('/avatar/:id', getAvatarById);
router.post('/avatar', verifyToken, updateAvatar);



module.exports = router
