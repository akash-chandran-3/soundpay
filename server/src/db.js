// One shared MySQL connection pool for the whole app.
// A pool reuses connections instead of opening a new one per request.
require('dotenv').config();
const mysql = require('mysql2/promise');
const { getDbConfig } = require('./dbConfig');

const pool = mysql.createPool({
  ...getDbConfig(),
  database: process.env.DB_NAME,
  connectionLimit: 10,
});

module.exports = pool;
