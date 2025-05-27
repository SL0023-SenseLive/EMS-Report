

// Constants
// const API_BASE_URL = 'http://98.70.25.143:8080';
const API_BASE_URL = 'http://localhost:5000';
const API_ENDPOINTS = {
    DEVICES: `${API_BASE_URL}/api/devices`,
    ENERGY_DATA: `${API_BASE_URL}/api/energy-data`,
    REPORT_PREVIEW: `${API_BASE_URL}/api/reports/preview`,
    GENERATE_PDF: `${API_BASE_URL}/api/reports/generate-pdf`,
    GENERATE_CSV: `${API_BASE_URL}/api/reports/generate-csv`,
    TEST_CONNECTION: `${API_BASE_URL}/test-connection`
};

// DOM Elements
const reportTypeSelect = document.getElementById('reportType');
const timePeriodSelect = document.getElementById('timePeriod');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const deviceIdInput = document.getElementById('deviceId');
const deviceSelector = document.getElementById('deviceSelector');
const previewReportBtn = document.getElementById('previewReportBtn');
const generatePdfBtn = document.getElementById('generatePdfBtn');
const generateCsvBtn = document.getElementById('generateCsvBtn');
const reportPreview = document.getElementById('reportPreview');
const statusMessage = document.getElementById('statusMessage');
const statusText = document.getElementById('statusText');

// Device data cache
let devicesData = [];
let selectedDeviceName = '';

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    // Set default dates (current month)
    setDefaultDates();
    
    // Initialize event listeners
    initEventListeners();
    
    // Test server connection
    testServerConnection();
    
    // Fetch devices
    fetchDevices();
});

// Set default dates (current month)
function setDefaultDates() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    
    startDateInput.value = formatDate(firstDay);
    endDateInput.value = formatDate(lastDay);
}

// Format date as YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Initialize event listeners
function initEventListeners() {
    // Preview report button
    previewReportBtn.addEventListener('click', previewReport);
    
    // Generate PDF button
    generatePdfBtn.addEventListener('click', generatePdf);
    
    // Generate CSV button
    generateCsvBtn.addEventListener('click', generateCsv);
    
    // Device ID input for showing device selector
    deviceIdInput.addEventListener('focus', showDeviceSelector);
    deviceIdInput.addEventListener('input', filterDevices);
    
    // Date validation - ensure end date is not before start date
    startDateInput.addEventListener('change', () => {
        if (endDateInput.value && new Date(startDateInput.value) > new Date(endDateInput.value)) {
            endDateInput.value = startDateInput.value;
        }
    });
    
    endDateInput.addEventListener('change', () => {
        if (startDateInput.value && new Date(endDateInput.value) < new Date(startDateInput.value)) {
            showStatus('warning', 'End date cannot be before start date');
            endDateInput.value = startDateInput.value;
        }
    });
    
    // Hide device selector when clicking outside
    document.addEventListener('click', function(event) {
        if (!deviceSelector.contains(event.target) && event.target !== deviceIdInput) {
            deviceSelector.style.display = 'none';
        }
    });
}

// Test server connection
async function testServerConnection() {
    try {
        showStatus('info', 'Testing connection to server...');
        const response = await fetch(API_ENDPOINTS.TEST_CONNECTION);
        if (response.ok) {
            showStatus('success', 'Connected to server successfully');
            setTimeout(() => {
                hideStatus();
            }, 3000);
        } else {
            showStatus('error', 'Failed to connect to server');
        }
    } catch (error) {
        console.error('Server connection test failed:', error);
        showStatus('error', 'Server connection failed. Check if the backend is running.');
    }
}

// Fetch devices from the API
async function fetchDevices() {
    try {
        showStatus('info', 'Fetching devices...');
        const response = await fetch(API_ENDPOINTS.DEVICES);
        
        if (!response.ok) {
            throw new Error(`Failed to fetch devices: ${response.statusText}`);
        }
        
        devicesData = await response.json();
        console.log('Devices fetched:', devicesData);
        hideStatus();
    } catch (error) {
        console.error('Error fetching devices:', error);
        showStatus('error', 'Failed to fetch devices. Check if the backend is running.');
    }
}

// Show device selector dropdown
function showDeviceSelector() {
    if (devicesData.length === 0) {
        showStatus('warning', 'No devices available. Please try again later.');
        return;
    }
    
    deviceSelector.innerHTML = '';
    
    devicesData.forEach(device => {
        const deviceItem = document.createElement('div');
        deviceItem.className = 'device-item';
        deviceItem.innerHTML = `
            <div class="device-name">${device.name || 'Unnamed Device'}</div>
            <div class="device-id">${device.id}</div>
        `;
        
        deviceItem.addEventListener('click', () => {
            selectDevice(device);
        });
        
        deviceSelector.appendChild(deviceItem);
    });
    
    deviceSelector.style.display = 'block';
}

// Filter devices based on input
function filterDevices() {
    const searchText = deviceIdInput.value.toLowerCase();
    const deviceItems = deviceSelector.querySelectorAll('.device-item');
    
    deviceItems.forEach(item => {
        const deviceName = item.querySelector('.device-name').textContent.toLowerCase();
        const deviceId = item.querySelector('.device-id').textContent.toLowerCase();
        
        if (deviceName.includes(searchText) || deviceId.includes(searchText)) {
            item.style.display = 'block';
        } else {
            item.style.display = 'none';
        }
    });
}

// Select a device from the dropdown
function selectDevice(device) {
    deviceIdInput.value = device.id;
    selectedDeviceName = device.name || 'Unnamed Device';
    deviceSelector.style.display = 'none';
}

// Preview report
async function previewReport() {
    try {
        // Validate inputs
        if (!validateInputs()) {
            return;
        }
        
        showStatus('info', 'Generating report preview...');
        
        // Use the dedicated server-side preview endpoint instead of manually formatting
        const response = await fetch(getPreviewEndpoint(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reportType: reportTypeSelect.value,
                deviceId: deviceIdInput.value,
                startDate: startDateInput.value,
                endDate: endDateInput.value,
                timePeriod: timePeriodSelect.value
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to generate preview');
        }
        
        const data = await response.json();
        
        // Use the server-generated HTML for the preview
        reportPreview.innerHTML = data.html;
        
        showStatus('success', 'Report preview generated successfully');
        
        setTimeout(() => {
            hideStatus();
        }, 3000);
    } catch (error) {
        console.error('Error generating report preview:', error);
        showStatus('error', `Failed to generate preview: ${error.message}`);
        
        // Display error message in preview area
        reportPreview.innerHTML = `
            <div class="report-header">
                <h2>Error Generating Preview</h2>
                <p class="report-info">${error.message}</p>
                <p class="report-info">Please check your inputs and try again.</p>
            </div>
        `;
    }
}

// Generate PDF report
async function generatePdf() {
    try {
        // Validate inputs
        if (!validateInputs()) {
            return;
        }
        
        showStatus('info', 'Generating PDF report...');
        
        const response = await fetch(getPdfEndpoint(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reportType: reportTypeSelect.value,
                deviceId: deviceIdInput.value,
                startDate: startDateInput.value,
                endDate: endDateInput.value,
                timePeriod: timePeriodSelect.value
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to generate PDF');
        }
        
        // Create a blob from the PDF stream
        const blob = await response.blob();
        
        // Create a link element to download the PDF
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = `${reportTypeSelect.value}_${deviceIdInput.value}_${startDateInput.value}_to_${endDateInput.value}.pdf`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        showStatus('success', 'PDF report generated successfully');
        
        setTimeout(() => {
            hideStatus();
        }, 3000);
    } catch (error) {
        console.error('Error generating PDF report:', error);
        showStatus('error', `Failed to generate PDF: ${error.message}`);
    }
}

// Generate CSV report
async function generateCsv() {
    try {
        // Validate inputs
        if (!validateInputs()) {
            return;
        }
        
        showStatus('info', 'Generating CSV report...');
        
        const response = await fetch(getCsvEndpoint(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                reportType: reportTypeSelect.value,
                deviceId: deviceIdInput.value,
                startDate: startDateInput.value,
                endDate: endDateInput.value,
                timePeriod: timePeriodSelect.value
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to generate CSV');
        }
        
        // Create a blob from the CSV data
        const blob = await response.blob();
        
        // Create a link element to download the CSV
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(blob);
        downloadLink.download = `${reportTypeSelect.value}_${deviceIdInput.value}_${startDateInput.value}_to_${endDateInput.value}.csv`;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        document.body.removeChild(downloadLink);
        
        showStatus('success', 'CSV report generated successfully');
        
        setTimeout(() => {
            hideStatus();
        }, 3000);
    } catch (error) {
        console.error('Error generating CSV report:', error);
        showStatus('error', `Failed to generate CSV: ${error.message}`);
    }
}

// Validate input fields
function validateInputs() {
    // Check device ID
    if (!deviceIdInput.value) {
        showStatus('error', 'Please select or enter a device ID');
        return false;
    }
    
    // Check start date
    if (!startDateInput.value) {
        showStatus('error', 'Please select a start date');
        return false;
    }
    
    // Check end date
    if (!endDateInput.value) {
        showStatus('error', 'Please select an end date');
        return false;
    }
    
    // Check date range
    const startDate = new Date(startDateInput.value);
    const endDate = new Date(endDateInput.value);
    
    if (startDate > endDate) {
        showStatus('error', 'Start date cannot be after end date');
        return false;
    }
    
    return true;
}

// Show status message
function showStatus(type, message) {
    statusText.textContent = message;
    statusMessage.className = 'status-message';
    
    switch (type) {
        case 'success':
            statusMessage.classList.add('status-success');
            break;
        case 'error':
            statusMessage.classList.add('status-error');
            break;
        case 'warning':
            statusMessage.classList.add('status-warning');
            break;
        case 'info':
        default:
            statusMessage.classList.add('status-info');
            break;
    }
    
    statusMessage.style.display = 'flex';
}

// Hide status message
function hideStatus() {
    statusMessage.style.display = 'none';
}

// Fixed endpoint functions - replace the existing ones in your index.js file

const getPdfEndpoint = () => {
  if (reportTypeSelect.value === 'demand_analysis') {
    return `${API_BASE_URL}/api/demand-reports/generate-pdf`;
  } else if (reportTypeSelect.value === 'power_quality') {
    return `${API_BASE_URL}/api/power-quality-reports/generate-pdf`;
  } else {
    return API_ENDPOINTS.GENERATE_PDF;
  }
};

const getCsvEndpoint = () => {
  if (reportTypeSelect.value === 'demand_analysis') {
    return `${API_BASE_URL}/api/demand-reports/generate-csv`;
  } else if (reportTypeSelect.value === 'power_quality') {
    return `${API_BASE_URL}/api/power-quality-reports/generate-csv`;
  } else {
    return API_ENDPOINTS.GENERATE_CSV;
  }
};

const getPreviewEndpoint = () => {
  if (reportTypeSelect.value === 'demand_analysis') {
    return `${API_BASE_URL}/api/demand-reports/preview`;
  } else if (reportTypeSelect.value === 'power_quality') {
    return `${API_BASE_URL}/api/power-quality-reports/preview`;
  } else {
    return API_ENDPOINTS.REPORT_PREVIEW;
  }
};