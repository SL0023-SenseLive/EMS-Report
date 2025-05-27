const express = require('express');
const router = express.Router();
const {
  getDemandData,
  getDemandReportPreview,
  generatePdf,
  generateCsv,
} = require('../controllers/demandAnalysisController');

// Get demand analysis data
router.get('/demand-data', getDemandData);

// Get demand report preview
router.post('/demand-reports/preview', getDemandReportPreview);

// Generate demand PDF report
router.post('/demand-reports/generate-pdf', generatePdf);

// Generate demand CSV report
router.post('/demand-reports/generate-csv', generateCsv);

module.exports = router;