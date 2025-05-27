const pool = require('../config/db');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { Parser } = require('json2csv');
const ejs = require('ejs');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

// Ensure TEMP_DIR exists
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

// Helper function to determine status based on value and thresholds
function getStatus(value, thresholds) {
  if (!value || isNaN(value)) return 'no-data';
  if (value >= thresholds.excellent.min && value <= thresholds.excellent.max) return 'excellent';
  if (value >= thresholds.good.min && value <= thresholds.good.max) return 'good';
  if (value >= thresholds.warning.min && value <= thresholds.warning.max) return 'warning';
  return 'critical';
}

// Power quality thresholds
const QUALITY_THRESHOLDS = {
  voltage: {
    excellent: { min: 220, max: 240 },
    good: { min: 210, max: 250 },
    warning: { min: 200, max: 260 },
  },
  frequency: {
    excellent: { min: 49.9, max: 50.1 },
    good: { min: 49.5, max: 50.5 },
    warning: { min: 49.0, max: 51.0 },
  },
  powerFactor: {
    excellent: { min: 0.95, max: 1.0 },
    good: { min: 0.85, max: 0.94 },
    warning: { min: 0.7, max: 0.84 },
  },
  thd: {
    excellent: { min: 0, max: 3 },
    good: { min: 3.1, max: 5 },
    warning: { min: 5.1, max: 8 },
  },
  voltageUnbalance: {
    excellent: { min: 0, max: 1 },
    good: { min: 1.1, max: 2 },
    warning: { min: 2.1, max: 3 },
  },
  currentUnbalance: {
    excellent: { min: 0, max: 5 },
    good: { min: 5.1, max: 10 },
    warning: { min: 10.1, max: 15 },
  }
};

// Helper function to get the correct entity_id for the device
async function getEntityIdForDevice(deviceId) {
  try {
    // First, try to find the device directly by ID
    let query = 'SELECT id FROM public.device WHERE id = $1';
    let result = await pool.query(query, [deviceId]);
    
    if (result.rows.length > 0) {
      console.log('Found device by direct ID match:', result.rows[0].id);
      return result.rows[0].id;
    }
    
    // If not found, try by name (in case deviceId is actually a name)
    query = 'SELECT id FROM public.device WHERE name = $1';
    result = await pool.query(query, [deviceId]);
    
    if (result.rows.length > 0) {
      console.log('Found device by name match:', result.rows[0].id);
      return result.rows[0].id;
    }
    
    // If still not found, try with UUID casting (for PostgreSQL UUID fields)
    try {
      query = 'SELECT id FROM public.device WHERE id::text = $1';
      result = await pool.query(query, [deviceId]);
      
      if (result.rows.length > 0) {
        console.log('Found device by UUID text match:', result.rows[0].id);
        return result.rows[0].id;
      }
    } catch (uuidError) {
      console.log('UUID casting failed, continuing with other methods');
    }
    
    console.log('Device not found with ID:', deviceId);
    return null;
  } catch (error) {
    console.error('Error finding device:', error);
    return null;
  }
}

// Generate empty/null data structure for given date range
function generateEmptyDataStructure(startDate, endDate, timePeriod) {
  const data = [];
  const start = moment(startDate);
  const end = moment(endDate);
  
  let current = start.clone();
  
  while (current.isSameOrBefore(end)) {
    data.push({
      period: current.format('YYYY-MM-DD'),
      Voltage_AN: 'N/A',
      Voltage_BN: 'N/A',
      Voltage_CN: 'N/A',
      Current_A: 'N/A',
      Current_B: 'N/A',
      Current_C: 'N/A',
      Frequency: 'N/A',
      Power_Factor: 'N/A',
      THD_Voltage: 'N/A',
      THD_Current: 'N/A',
      Voltage_Unbalance: 'N/A',
      Current_Unbalance: 'N/A'
    });
    
    // Increment based on time period
    switch (timePeriod) {
      case 'daily':
        current.add(1, 'day');
        break;
      case 'weekly':
        current.add(1, 'week');
        break;
      case 'monthly':
        current.add(1, 'month');
        break;
      default:
        current.add(1, 'day');
    }
  }
  
  return data;
}

// Debug function to check available data
async function debugDataAvailability(deviceId, startDate, endDate) {
  try {
    console.log('=== DEBUG: Checking data availability ===');
    
    // Get entity ID
    const entityId = await getEntityIdForDevice(deviceId);
    if (!entityId) {
      console.log('No entity found for device ID:', deviceId);
      return;
    }
    
    // Check available keys
    const keysQuery = `
      SELECT DISTINCT kd.key, COUNT(*) as count
      FROM public.ts_kv ts_kv
      JOIN public.key_dictionary kd ON kd.key_id = ts_kv.key
      WHERE ts_kv.entity_id = $1
        AND to_timestamp(ts_kv.ts / 1000.0) BETWEEN $2 AND $3
      GROUP BY kd.key
      ORDER BY count DESC;
    `;
    
    const keysResult = await pool.query(keysQuery, [entityId, startDate, endDate]);
    console.log('Available keys for this device and date range:');
    keysResult.rows.forEach(row => {
      console.log(`  ${row.key}: ${row.count} records`);
    });
    
    // Check date range
    const dateQuery = `
      SELECT 
        MIN(to_timestamp(ts_kv.ts / 1000.0)) as min_date,
        MAX(to_timestamp(ts_kv.ts / 1000.0)) as max_date,
        COUNT(*) as total_records
      FROM public.ts_kv ts_kv
      WHERE ts_kv.entity_id = $1;
    `;
    
    const dateResult = await pool.query(dateQuery, [entityId]);
    if (dateResult.rows.length > 0) {
      const { min_date, max_date, total_records } = dateResult.rows[0];
      console.log('Data date range for device:');
      console.log(`  Min date: ${min_date}`);
      console.log(`  Max date: ${max_date}`);
      console.log(`  Total records: ${total_records}`);
      console.log(`  Requested range: ${startDate} to ${endDate}`);
    }
    
  } catch (error) {
    console.error('Debug query failed:', error);
  }
}

// Main function to get power quality data from database
async function getPowerQualityDataFromDB(deviceId, startDate, endDate, timePeriod) {
  console.log('=== Getting power quality data ===');
  console.log('Parameters:', { deviceId, startDate, endDate, timePeriod });
  
  // Get the correct entity ID
  const entityId = await getEntityIdForDevice(deviceId);
  if (!entityId) {
    console.log('Entity ID not found for device:', deviceId);
    console.log('Generating empty data structure for missing device');
    return generateEmptyDataStructure(startDate, endDate, timePeriod);
  }
  
  console.log('Using entity ID:', entityId);
  
  // Run debug check
  await debugDataAvailability(deviceId, startDate, endDate);
  
  const query = `
    WITH keys AS (
      SELECT key_id, key
      FROM public.key_dictionary
      WHERE key IN (
        'V_L1_L2', 'V_L2_L3', 'V_L3_L1',
        'I_L1', 'I_L2', 'I_L3',
        'Frequency', 'PF_Total',
        'THD_V1', 'THD_I1',
        'Voltage_Unbalance', 'Current_Unbalance'
      )
    ),
    kv_filtered AS (
      SELECT 
        to_timestamp(ts_kv.ts / 1000.0) AS ts,
        kd.key,
        CASE 
          WHEN ts_kv.dbl_v IS NOT NULL THEN ts_kv.dbl_v
          WHEN ts_kv.long_v IS NOT NULL THEN ts_kv.long_v::numeric
          WHEN ts_kv.str_v IS NOT NULL AND ts_kv.str_v ~ '^[0-9]+\.?[0-9]*$' THEN ts_kv.str_v::numeric
          ELSE NULL
        END AS value
      FROM public.ts_kv ts_kv
      JOIN keys kd ON kd.key_id = ts_kv.key
      WHERE ts_kv.entity_id = $1
        AND to_timestamp(ts_kv.ts / 1000.0) BETWEEN $2 AND $3
        AND (ts_kv.dbl_v IS NOT NULL OR ts_kv.long_v IS NOT NULL OR 
             (ts_kv.str_v IS NOT NULL AND ts_kv.str_v ~ '^[0-9]+\.?[0-9]*$'))
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
          ELSE date_trunc('day', ts)
        END AS period
      FROM kv_filtered
      WHERE value IS NOT NULL
    ),
    -- Aggregate values (average for most parameters)
    aggregated_values AS (
      SELECT
        period,
        key,
        AVG(value) AS aggregated_value,
        COUNT(*) as record_count
      FROM kv_period
      GROUP BY period, key
      HAVING COUNT(*) > 0
    ),
    -- Pivot the aggregated values
    pivoted_values AS (
      SELECT
        period,
        MAX(CASE WHEN key = 'V_L1_L2' THEN aggregated_value END) AS "Voltage_AN",
        MAX(CASE WHEN key = 'V_L2_L3' THEN aggregated_value END) AS "Voltage_BN",
        MAX(CASE WHEN key = 'V_L3_L1' THEN aggregated_value END) AS "Voltage_CN",
        MAX(CASE WHEN key = 'I_L1' THEN aggregated_value END) AS "Current_A",
        MAX(CASE WHEN key = 'I_L2' THEN aggregated_value END) AS "Current_B",
        MAX(CASE WHEN key = 'I_L3' THEN aggregated_value END) AS "Current_C",
        MAX(CASE WHEN key = 'Frequency' THEN aggregated_value END) AS "Frequency",
        MAX(CASE WHEN key = 'PF_Total' THEN aggregated_value END) AS "Power_Factor",
        MAX(CASE WHEN key = 'THD_V1' THEN aggregated_value END) AS "THD_Voltage",
        MAX(CASE WHEN key = 'THD_I1' THEN aggregated_value END) AS "THD_Current",
        MAX(CASE WHEN key = 'Voltage_Unbalance' THEN aggregated_value END) AS "Voltage_Unbalance",
        MAX(CASE WHEN key = 'Current_Unbalance' THEN aggregated_value END) AS "Current_Unbalance",
        SUM(CASE WHEN key IN ('Voltage_AN', 'Voltage_BN', 'Voltage_CN', 'Current_A', 'Current_B', 'Current_C', 'Frequency', 'Power_Factor', 'THD_Voltage', 'THD_Current', 'Voltage_Unbalance', 'Current_Unbalance') THEN 1 ELSE 0 END) as total_keys
      FROM aggregated_values
      GROUP BY period
      HAVING SUM(CASE WHEN key IN ('Voltage_AN', 'Voltage_BN', 'Voltage_CN', 'Current_A', 'Current_B', 'Current_C', 'Frequency', 'Power_Factor', 'THD_Voltage', 'THD_Current', 'Voltage_Unbalance', 'Current_Unbalance') THEN 1 ELSE 0 END) > 0
    )
    SELECT * FROM pivoted_values
    ORDER BY period;
  `;

  const values = [entityId, startDate, endDate, timePeriod];
  console.log('Executing query with values:', values);
  
  try {
    const { rows } = await pool.query(query, values);
    console.log('Query returned', rows.length, 'rows');
    
    if (rows.length === 0) {
      console.log('No data found - generating empty data structure');
      return generateEmptyDataStructure(startDate, endDate, timePeriod);
    }

    // Process data for better formatting
    const formattedData = rows.map(row => ({
      period: moment(row.period).format('YYYY-MM-DD'),
      Voltage_AN: row.Voltage_AN ? parseFloat(row.Voltage_AN).toFixed(2) : 'N/A',
      Voltage_BN: row.Voltage_BN ? parseFloat(row.Voltage_BN).toFixed(2) : 'N/A',
      Voltage_CN: row.Voltage_CN ? parseFloat(row.Voltage_CN).toFixed(2) : 'N/A',
      Current_A: row.Current_A ? parseFloat(row.Current_A).toFixed(2) : 'N/A',
      Current_B: row.Current_B ? parseFloat(row.Current_B).toFixed(2) : 'N/A',
      Current_C: row.Current_C ? parseFloat(row.Current_C).toFixed(2) : 'N/A',
      Frequency: row.Frequency ? parseFloat(row.Frequency).toFixed(2) : 'N/A',
      Power_Factor: row.Power_Factor ? parseFloat(row.Power_Factor).toFixed(3) : 'N/A',
      THD_Voltage: row.THD_Voltage ? parseFloat(row.THD_Voltage).toFixed(2) : 'N/A',
      THD_Current: row.THD_Current ? parseFloat(row.THD_Current).toFixed(2) : 'N/A',
      Voltage_Unbalance: row.Voltage_Unbalance ? parseFloat(row.Voltage_Unbalance).toFixed(2) : 'N/A',
      Current_Unbalance: row.Current_Unbalance ? parseFloat(row.Current_Unbalance).toFixed(2) : 'N/A'
    }));

    console.log('Formatted data:', formattedData.length, 'records');
    return formattedData;
  } catch (error) {
    console.error('Database query error:', error);
    console.log('Generating empty data structure due to query error');
    return generateEmptyDataStructure(startDate, endDate, timePeriod);
  }
}

async function getPowerQualityData(req, res) {
  try {
    const { deviceId, startDate, endDate, timePeriod } = req.query;

    console.log('Received power quality analysis request with params:', req.query);

    // Validate inputs
    if (!deviceId || !startDate || !endDate || !timePeriod) {
      return res.status(400).json({ error: 'Missing required query params.' });
    }
    if (!['daily', 'weekly', 'monthly'].includes(timePeriod)) {
      return res.status(400).json({ error: 'Invalid timePeriod value.' });
    }

    // Always get data (will return empty structure if no data available)
    const formattedData = await getPowerQualityDataFromDB(deviceId, startDate, endDate, timePeriod);

    console.log('Power quality analysis query executed successfully:', formattedData.length, 'records');
    
    // Add metadata to indicate if data is available
    const hasActualData = formattedData.some(row => 
      Object.values(row).some(value => value !== 'N/A' && value !== row.period)
    );
    
    res.json({
      data: formattedData,
      metadata: {
        hasData: hasActualData,
        message: hasActualData ? 'Data retrieved successfully' : 'No data available for the specified parameters. Report generated with placeholder values.'
      }
    });
  } catch (error) {
    console.error('Error in getPowerQualityData:', error);
    res.status(500).json({ error: 'Internal Server Error: ' + error.message });
  }
}

// Helper function to get template data with power quality analysis
async function getTemplateData(deviceId, startDate, endDate, timePeriod, data) {
  // Check if we have actual data or just placeholders
  const hasActualData = data.some(row => 
    Object.values(row).some(value => value !== 'N/A' && value !== row.period)
  );

  let avgVoltageAN, avgVoltageBN, avgVoltageCN, avgVoltage;
  let avgFrequency, avgPowerFactor, avgTHDVoltage, avgTHDCurrent, avgTHD;
  let maxVoltageUnbalance, maxCurrentUnbalance;
  let voltageStatus, frequencyStatus, powerFactorStatus, thdStatus;
  let voltageUnbalanceStatus, currentUnbalanceStatus;

  if (hasActualData) {
    // Calculate actual statistics only for rows with real data
    const validData = data.filter(row => 
      Object.values(row).some(value => value !== 'N/A' && value !== row.period)
    );

    if (validData.length > 0) {
      avgVoltageAN = validData.reduce((sum, item) => {
        const val = parseFloat(item.Voltage_AN);
        return sum + (isNaN(val) ? 0 : val);
      }, 0) / validData.length;
      
      avgVoltageBN = validData.reduce((sum, item) => {
        const val = parseFloat(item.Voltage_BN);
        return sum + (isNaN(val) ? 0 : val);
      }, 0) / validData.length;
      
      avgVoltageCN = validData.reduce((sum, item) => {
        const val = parseFloat(item.Voltage_CN);
        return sum + (isNaN(val) ? 0 : val);
      }, 0) / validData.length;
      
      avgVoltage = (avgVoltageAN + avgVoltageBN + avgVoltageCN) / 3;
      
      avgFrequency = validData.reduce((sum, item) => {
        const val = parseFloat(item.Frequency);
        return sum + (isNaN(val) ? 0 : val);
      }, 0) / validData.length;
      
      avgPowerFactor = validData.reduce((sum, item) => {
        const val = parseFloat(item.Power_Factor);
        return sum + (isNaN(val) ? 0 : val);
      }, 0) / validData.length;
      
      avgTHDVoltage = validData.reduce((sum, item) => {
        const val = parseFloat(item.THD_Voltage);
        return sum + (isNaN(val) ? 0 : val);
      }, 0) / validData.length;
      
      avgTHDCurrent = validData.reduce((sum, item) => {
        const val = parseFloat(item.THD_Current);
        return sum + (isNaN(val) ? 0 : val);
      }, 0) / validData.length;
      
      avgTHD = (avgTHDVoltage + avgTHDCurrent) / 2;
      
      maxVoltageUnbalance = Math.max(...validData.map(item => {
        const val = parseFloat(item.Voltage_Unbalance);
        return isNaN(val) ? 0 : val;
      }));
      
      maxCurrentUnbalance = Math.max(...validData.map(item => {
        const val = parseFloat(item.Current_Unbalance);
        return isNaN(val) ? 0 : val;
      }));
      
      // Determine status for each parameter
      voltageStatus = getStatus(avgVoltage, QUALITY_THRESHOLDS.voltage);
      frequencyStatus = getStatus(avgFrequency, QUALITY_THRESHOLDS.frequency);
      powerFactorStatus = getStatus(avgPowerFactor, QUALITY_THRESHOLDS.powerFactor);
      thdStatus = getStatus(avgTHD, QUALITY_THRESHOLDS.thd);
      voltageUnbalanceStatus = getStatus(maxVoltageUnbalance, QUALITY_THRESHOLDS.voltageUnbalance);
      currentUnbalanceStatus = getStatus(maxCurrentUnbalance, QUALITY_THRESHOLDS.currentUnbalance);
    }
  }

  // Set default values for no data scenarios
  if (!hasActualData || !avgVoltage) {
    avgVoltage = null;
    avgFrequency = null;
    avgPowerFactor = null;
    avgTHD = null;
    maxVoltageUnbalance = null;
    maxCurrentUnbalance = null;
    voltageStatus = 'no-data';
    frequencyStatus = 'no-data';
    powerFactorStatus = 'no-data';
    thdStatus = 'no-data';
    voltageUnbalanceStatus = 'no-data';
    currentUnbalanceStatus = 'no-data';
  }
  
  // Format dates
  const formattedStartDate = moment(startDate).format('MMMM D, YYYY');
  const formattedEndDate = moment(endDate).format('MMMM D, YYYY');
  
  // Get device name
  let deviceName = "Unknown Device";
  try {
    const deviceResponse = await pool.query('SELECT name FROM public.device WHERE id = $1', [deviceId]);
    if (deviceResponse.rows.length > 0) {
      deviceName = deviceResponse.rows[0].name;
    } else {
      deviceName = `Device ${deviceId} (Not Found)`;
    }
  } catch (error) {
    console.error('Error getting device name:', error);
    deviceName = `Device ${deviceId}`;
  }

  return {
    deviceName,
    deviceId,
    formattedStartDate,
    formattedEndDate,
    timePeriod: timePeriod.charAt(0).toUpperCase() + timePeriod.slice(1),
    avgVoltage: avgVoltage ? avgVoltage.toFixed(2) : 'N/A',
    avgFrequency: avgFrequency ? avgFrequency.toFixed(2) : 'N/A',
    avgPowerFactor: avgPowerFactor ? avgPowerFactor.toFixed(3) : 'N/A',
    avgTHD: avgTHD ? avgTHD.toFixed(2) : 'N/A',
    maxVoltageUnbalance: maxVoltageUnbalance ? maxVoltageUnbalance.toFixed(2) : 'N/A',
    maxCurrentUnbalance: maxCurrentUnbalance ? maxCurrentUnbalance.toFixed(2) : 'N/A',
    voltageStatus,
    frequencyStatus,
    powerFactorStatus,
    thdStatus,
    voltageUnbalanceStatus,
    currentUnbalanceStatus,
    hasData: hasActualData,
    data
  };
}

async function getPowerQualityReportPreview(req, res) {
  try {
    const { reportType, timePeriod, startDate, endDate, deviceId } = req.body;

    if (!reportType || !timePeriod || !startDate || !endDate || !deviceId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (reportType !== 'power_quality') {
      return res.status(400).json({ error: 'Only power_quality reports are supported for preview' });
    }

    console.log('Getting power quality data for preview with params:', { deviceId, startDate, endDate, timePeriod });

    // Get the power quality data (will return empty structure if no data available)
    const data = await getPowerQualityDataFromDB(deviceId, startDate, endDate, timePeriod);

    console.log('Found', data.length, 'records for power quality preview');

    // Get template data
    const templateData = await getTemplateData(deviceId, startDate, endDate, timePeriod, data);

    // Render the EJS template
    const templatePath = path.join(__dirname, '..', 'views', 'powerqualityReport.ejs');
    const html = await ejs.renderFile(templatePath, templateData);

    res.json({ 
      html,
      metadata: {
        hasData: templateData.hasData,
        message: templateData.hasData ? 'Report generated successfully' : 'Report generated with no data available'
      }
    });
  } catch (error) {
    console.error('Error generating power quality report preview:', error);
    res.status(500).json({ error: 'Failed to generate preview: ' + error.message });
  }
}

async function generatePdf(req, res) {
  try {
    const { reportType, timePeriod, startDate, endDate, deviceId } = req.body;

    if (!reportType || !timePeriod || !startDate || !endDate || !deviceId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    if (reportType !== 'power_quality') {
      return res.status(400).json({ error: 'Only power_quality reports are supported' });
    }

    console.log('Generating PDF for power quality with params:', { deviceId, startDate, endDate, timePeriod });

    // Get the power quality data (will return empty structure if no data available)
    const data = await getPowerQualityDataFromDB(deviceId, startDate, endDate, timePeriod);

    // Get template data
    const templateData = await getTemplateData(deviceId, startDate, endDate, timePeriod, data);

    // Generate PDF using EJS template and Puppeteer
    const pdfPath = await generatePowerQualityPdfFromEjs(templateData, deviceId, startDate, endDate);

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
    console.error('Error generating power quality PDF report:', error);
    res.status(500).json({ error: 'Failed to generate PDF report: ' + error.message });
  }
}

// Generate PDF using EJS template and Puppeteer
async function generatePowerQualityPdfFromEjs(templateData, deviceId, startDate, endDate) {
  return new Promise(async (resolve, reject) => {
    let browser;
    try {
      const filename = `power_quality_${deviceId}_${startDate}_to_${endDate}.pdf`;
      const filePath = path.join(TEMP_DIR, filename);

      // Render the EJS template
      const templatePath = path.join(__dirname, '..', 'views', 'powerqualityReport.ejs');
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

    if (reportType !== 'power_quality') {
      return res.status(400).json({ error: 'Only power_quality reports are supported' });
    }

    console.log('Generating CSV for power quality with params:', { deviceId, startDate, endDate, timePeriod });

    // Get the power quality data directly from database instead of using fetch
    const data = await getPowerQualityDataFromDB(deviceId, startDate, endDate, timePeriod);

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'No data found for the specified parameters' });
    }

    // Generate CSV string
    const csvString = generatePowerQualityCsvString(data);

    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 
      `attachment; filename=power_quality_${deviceId}_${startDate}_to_${endDate}.csv`);

    // Send the CSV data
    res.send(csvString);
  } catch (error) {
    console.error('Error generating power quality CSV report:', error);
    res.status(500).json({ error: 'Failed to generate CSV report: ' + error.message });
  }
}

// Generate CSV from power quality data
function generatePowerQualityCsvString(data) {
  try {
    const fields = [
      'period', 'V_L1_L2', 'V_L2_L3', 'V_L3_L1',
        'I_L1', 'I_L2', 'I_L3',
        'Frequency', 'PF_Total',
        'THD_V1', 'THD_I1',
        'Voltage_Unbalance', 'Current_Unbalance'
    ];
    const json2csvParser = new Parser({ fields });
    return json2csvParser.parse(data);
  } catch (error) {
    console.error('Error generating power quality CSV:', error);
    throw error;
  }
}

module.exports = {
  getPowerQualityData,
  getPowerQualityReportPreview,
  generatePdf,
  generateCsv,
};