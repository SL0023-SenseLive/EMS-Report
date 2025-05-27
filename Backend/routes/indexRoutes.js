// routes/homeRoutes.js
const express = require('express');
const path = require('path');
const router = express.Router();
const indexController = require('../controllers/indexController');


// Home route
router.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'views', 'index.html'));
});



router.get('/devices', indexController.getDevices);



module.exports = router;
