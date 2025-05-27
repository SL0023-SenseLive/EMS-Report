const express = require('express');
const router = express.Router();        

const powerqualityController = require('../controllers/powerqualityController');



// Get power equality data
router.get('/power-quality-data', powerqualityController.getPowerQualityData);

// Get power quality report preview
router.post('/power-quality-reports/preview', powerqualityController.getPowerQualityReportPreview);

// Generate power equality PDF report 
router.post('/power-quality-reports/generate-pdf', powerqualityController.generatePdf);

// Generate power equality CSV report
router.post('/power-quality-reports/generate-csv', powerqualityController.generateCsv);

module.exports = router;