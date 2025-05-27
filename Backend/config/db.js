const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
    return;
  }
  client.query('SELECT current_database()', (error, results) => {
    release();
    if (error) {
      console.error('Error fetching database name:', error.stack);
    } else {
      console.log(`Connected to database: ${results.rows[0].current_database}`);
    }
  });
});

module.exports = pool;