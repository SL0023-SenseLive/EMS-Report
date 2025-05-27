const pool = require('../config/db');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer'); // Add this dependency
const { Parser } = require('json2csv');
const ejs = require('ejs');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// Ensure TEMP_DIR exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

async function getDemandData(req, res) {
  try {
    const { deviceId, startDate, endDate, timePeriod } = req.query;

    console.log('Received demand analysis request with params:', req.query);
    
    // Validate inputs
    if (!deviceId || !startDate || !endDate || !timePeriod) {
      return res.status(400).json({ error: 'Missing required query params.' });
    }
    if (!['daily', 'weekly', 'monthly'].includes(timePeriod)) {
      return res.status(400).json({ error: 'Invalid timePeriod value.' });
    }

    const query = `
      WITH keys AS (
        SELECT key_id, key
        FROM public.key_dictionary
        WHERE key IN (
          'KW_Demand', 'KVA_Demand', 'KVAR_Demand', 'maxD_KW',
          'maxD_kVA', 'maxD_kVAr', 'PF_Total',
          'Frequency', 'I_L1', 'I_L2', 'I_L3',
          'V_L1_L2', 'V_L2_L3', 'V_L3_L1'
        )
      ),
      kv_filtered AS (
        SELECT 
          to_timestamp(ts_kv.ts / 1000.0) AS ts,
          kd.key,
          NULLIF(COALESCE(ts_kv.dbl_v::text, ts_kv.long_v::text, ts_kv.str_v), '')::numeric AS value
        FROM public.ts_kv ts_kv
        JOIN keys kd ON kd.key_id = ts_kv.key
        WHERE ts_kv.entity_id = $1
          AND to_timestamp(ts_kv.ts / 1000.0) BETWEEN $2 AND $3
      ),
      kv_period AS (
        SELECT 
          ts,
          key,
          value,
          CASE 
            WHEN $4 = 'daily' THEN date_trunc('day', ts)
            WHEN $4 = 'weekly' THEN date_trunc('week', ts)
            WHEN $4 = 'monthly' THEN date_trunc('month', ts)
          END AS period
        FROM kv_filtered
      ),
      -- Aggregate demand values (average for demand, max for max_demand)
      aggregated_values AS (
        SELECT
          period,
          key,
          CASE 
            WHEN key LIKE '%Max%' THEN MAX(value)
            ELSE AVG(value)
          END AS aggregated_value
        FROM kv_period
        GROUP BY period, key
      ),
      -- Pivot the aggregated values
      pivoted_values AS (
        SELECT
          period,
          MAX(CASE WHEN key = 'KW_Demand' THEN aggregated_value END) AS "KW_Demand",
          MAX(CASE WHEN key = 'KVA_Demand' THEN aggregated_value END) AS "KVA_Demand",
          MAX(CASE WHEN key = 'KVAR_Demand' THEN aggregated_value END) AS "KVAR_Demand",
          MAX(CASE WHEN key = 'maxD_KW' THEN aggregated_value END) AS "KW_Max_Demand",
          MAX(CASE WHEN key = 'maxD_kVA' THEN aggregated_value END) AS "KVA_Max_Demand",
          MAX(CASE WHEN key = 'maxD_kVAr' THEN aggregated_value END) AS "KVAR_Max_Demand",
          MAX(CASE WHEN key = 'PF_Total' THEN aggregated_value END) AS "Power_Factor",
          MAX(CASE WHEN key = 'Frequency' THEN aggregated_value END) AS "Frequency",
          MAX(CASE WHEN key = 'I_L1' THEN aggregated_value END) AS "Current_A",
          MAX(CASE WHEN key = 'I_L2' THEN aggregated_value END) AS "Current_B",
          MAX(CASE WHEN key = 'I_L3' THEN aggregated_value END) AS "Current_C",
          MAX(CASE WHEN key = 'V_L1_L2' THEN aggregated_value END) AS "Voltage_AN",
          MAX(CASE WHEN key = 'V_L2_L3' THEN aggregated_value END) AS "Voltage_BN",
          MAX(CASE WHEN key = 'V_L3_L1' THEN aggregated_value END) AS "Voltage_CN"
        FROM aggregated_values
        GROUP BY period
      )
      SELECT * FROM pivoted_values
      ORDER BY period;
    `;

    const values = [deviceId, startDate, endDate, timePeriod];
    const { rows } = await pool.query(query, values);

    // Process data for better formatting
    const formattedData = rows.map(row => ({
      period: moment(row.period).format('YYYY-MM-DD'),
      KW_Demand: parseFloat(row.KW_Demand || 0).toFixed(2),
      KVA_Demand: parseFloat(row.KVA_Demand || 0).toFixed(2),
      KVAR_Demand: parseFloat(row.KVAR_Demand || 0).toFixed(2),
      KW_Max_Demand: parseFloat(row.KW_Max_Demand || 0).toFixed(2),
      KVA_Max_Demand: parseFloat(row.KVA_Max_Demand || 0).toFixed(2),
      KVAR_Max_Demand: parseFloat(row.KVAR_Max_Demand || 0).toFixed(2),
      Power_Factor: parseFloat(row.Power_Factor || 0).toFixed(3),
      Frequency: parseFloat(row.Frequency || 0).toFixed(2),
      Current_A: parseFloat(row.Current_A || 0).toFixed(2),
      Current_B: parseFloat(row.Current_B || 0).toFixed(2),
      Current_C: parseFloat(row.Current_C || 0).toFixed(2),
      Voltage_AN: parseFloat(row.Voltage_AN || 0).toFixed(2),
      Voltage_BN: parseFloat(row.Voltage_BN || 0).toFixed(2),
      Voltage_CN: parseFloat(row.Voltage_CN || 0).toFixed(2)
    }));

    console.log('Demand analysis query executed successfully:', formattedData.length, 'records');
    res.json(formattedData);
  } catch (error) {
    console.error('Error in getDemandData:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

// Helper function to get template data
async function getTemplateData(deviceId, startDate, endDate, timePeriod, data) {
  // Calculate summary statistics
  const avgKWDemand = data.reduce((sum, item) => sum + parseFloat(item.KW_Demand), 0) / data.length;
  const maxKWDemand = Math.max(...data.map(item => parseFloat(item.KW_Max_Demand)));
  const avgPowerFactor = data.reduce((sum, item) => sum + parseFloat(item.Power_Factor), 0) / data.length;
  const peakDemandPeriod = data.find(item => parseFloat(item.KW_Max_Demand) === maxKWDemand);
  
  // Format dates
  const formattedStartDate = moment(startDate).format('MMMM D, YYYY');
  const formattedEndDate = moment(endDate).format('MMMM D, YYYY');
  
  // Get device name
  let deviceName = "Unknown Device";
  try {
    const deviceResponse = await pool.query('SELECT name FROM public.device WHERE id = $1', [deviceId]);
    if (deviceResponse.rows.length > 0) {
      deviceName = deviceResponse.rows[0].name;
    }
  } catch (error) {
    console.error('Error getting device name:', error);
  }

  return {
    deviceName,
    deviceId,
    formattedStartDate,
    formattedEndDate,
    timePeriod: timePeriod.charAt(0).toUpperCase() + timePeriod.slice(1),
    avgKWDemand: avgKWDemand.toFixed(2),
    maxKWDemand: maxKWDemand.toFixed(2),
    avgPowerFactor: avgPowerFactor.toFixed(3),
    peakDemandPeriod: peakDemandPeriod ? peakDemandPeriod.period : 'N/A',
    data
  };
}

async function getDemandReportPreview(req, res) {
  try {
    const { reportType, timePeriod, startDate, endDate, deviceId } = req.body;

    if (!reportType || !timePeriod || !startDate || !endDate || !deviceId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (reportType !== 'demand_analysis') {
      return res.status(400).json({ error: 'Only demand_analysis reports are supported for preview' });
    }

    // Get the demand data
    const response = await fetch(`http://localhost:5000/api/demand-data?deviceId=${deviceId}&startDate=${startDate}&endDate=${endDate}&timePeriod=${timePeriod}`);
    const data = await response.json();

    // Get template data
    const templateData = await getTemplateData(deviceId, startDate, endDate, timePeriod, data);

    // Render the EJS template
    const templatePath = path.join(__dirname, '..', 'views', 'demandReportTemplate.ejs');
    const html = await ejs.renderFile(templatePath, templateData);

    res.json({ html });
  } catch (error) {
    console.error('Error generating demand report preview:', error);
    res.status(500).json({ error: 'Failed to generate preview' });
  }
}

async function generatePdf(req, res) {
  try {
    const { reportType, timePeriod, startDate, endDate, deviceId } = req.body;

    if (!reportType || !timePeriod || !startDate || !endDate || !deviceId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (reportType !== 'demand_analysis') {
      return res.status(400).json({ error: 'Only demand_analysis reports are supported' });
    }

    // Get the demand data
    const apiUrl = `http://localhost:5000/api/demand-data?deviceId=${deviceId}&startDate=${startDate}&endDate=${endDate}&timePeriod=${timePeriod}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    // Get template data
    const templateData = await getTemplateData(deviceId, startDate, endDate, timePeriod, data);

    // Generate PDF using EJS template and Puppeteer
    const pdfPath = await generateDemandPdfFromEjs(templateData, deviceId, startDate, endDate);

    // Send the file
    res.download(pdfPath, path.basename(pdfPath), (err) => {
      if (err) {
        console.error('Error sending file:', err);
      }

      // Delete the file after sending
      fs.unlink(pdfPath, (unlinkErr) => {
        if (unlinkErr) {
          console.error('Error deleting file:', unlinkErr);
        }
      });
    });
  } catch (error) {
    console.error('Error generating demand PDF report:', error);
    res.status(500).json({ error: 'Failed to generate PDF report' });
  }
}

// Generate PDF using EJS template and Puppeteer
async function generateDemandPdfFromEjs(templateData, deviceId, startDate, endDate) {
  return new Promise(async (resolve, reject) => {
    let browser;
    try {
      const filename = `demand_analysis_${deviceId}_${startDate}_to_${endDate}.pdf`;
      const filePath = path.join(TEMP_DIR, filename);

      // Render the EJS template
      const templatePath = path.join(__dirname, '..', 'views', 'demandReportTemplate.ejs');
      const html = await ejs.renderFile(templatePath, {
        ...templateData,
        isPdfMode: true // Add flag to identify PDF mode in template
      });

      // Launch Puppeteer
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      
      // Set content and wait for it to load
      await page.setContent(html, { 
        waitUntil: 'networkidle0',
        timeout: 30000 
      });

      // Generate PDF with optimized settings
      await page.pdf({
        path: filePath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm'
        },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>', // Empty header
        footerTemplate: `
          <div style="font-size: 10px; text-align: center; width: 100%; color: #666;">
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
          </div>
        `,
        preferCSSPageSize: true
      });

      await browser.close();
      resolve(filePath);
    } catch (error) {
      if (browser) {
        await browser.close();
      }
      reject(error);
    }
  });
}

async function generateCsv(req, res) {
  try {
    const { reportType, timePeriod, startDate, endDate, deviceId } = req.body;

    if (!reportType || !timePeriod || !startDate || !endDate || !deviceId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (reportType !== 'demand_analysis') {
      return res.status(400).json({ error: 'Only demand_analysis reports are supported' });
    }

    // Get the demand data
    const apiUrl = `http://localhost:5000/api/demand-data?deviceId=${deviceId}&startDate=${startDate}&endDate=${endDate}&timePeriod=${timePeriod}`;
    const response = await fetch(apiUrl);
    const data = await response.json();

    // Generate CSV string
    const csvString = generateDemandCsvString(data);

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 
      `attachment; filename=demand_analysis_${deviceId}_${startDate}_to_${endDate}.csv`);

    // Send the CSV data
    res.send(csvString);
  } catch (error) {
    console.error('Error generating demand CSV report:', error);
    res.status(500).json({ error: 'Failed to generate CSV report' });
  }
}

// Generate CSV from demand data
function generateDemandCsvString(data) {
  try {
    const fields = [
      'period',  'KW_Demand', 'KVA_Demand', 'KVAR_Demand', 'maxD_KW',
          'maxD_kVA', 'maxD_kVAr', 'PF_Total',
          'Frequency', 'I_L1', 'I_L2', 'I_L3',
          'V_L1_L2', 'V_L2_L3', 'V_L3_L1'
    ];
    const json2csvParser = new Parser({ fields });
    return json2csvParser.parse(data);
  } catch (error) {
    console.error('Error generating demand CSV:', error);
    throw error;
  }
}

module.exports = {
  getDemandData,
  getDemandReportPreview,
  generatePdf,
  generateCsv,
};