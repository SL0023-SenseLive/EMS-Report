const pool = require('../config/db');

const getDevices = async (req, res) => {
  try {
    const query = 'SELECT id, name FROM device;';
    const { rows } = await pool.query(query);
    const devices = rows.map(row => ({
      id: row.id,
      name: row.name
    }));
    res.json(devices);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
};

module.exports = {
  getDevices
};