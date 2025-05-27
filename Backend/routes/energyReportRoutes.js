const express = require('express');
const router = express.Router();
const reportController = require('../controllers/energyReportController');

router.get('/energy-data', reportController.getEnergyData);
router.post('/reports/preview', reportController.getReportPreview);
router.post('/reports/generate-pdf', reportController.generatePdf);
router.post('/reports/generate-csv', reportController.generateCsv);

module.exports = router;