const express = require('express');
const router = express.Router();
const { createUser, loginUser, getLineAuthUrl, lineCallback } = require('../controllers/user')


router.post('/create', createUser);

router.post('/login', loginUser);
router.get('/line-auth', getLineAuthUrl);
router.get('/line/callback', lineCallback);


module.exports = router
