const express = require('express');
const router = express.Router();
const { createUser, loginUser, getLineAuthUrl, lineCallback, liffLogin } = require('../controllers/user')


router.post('/create', createUser);

router.post('/login', loginUser);
router.get('/line-auth', getLineAuthUrl);
router.get('/line/callback', lineCallback);
router.post('/liff-login', liffLogin);


module.exports = router
