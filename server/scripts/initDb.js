// Creates the database (if missing) and the tables from schema.sql.
// Usage: npm run db:init
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { getDbConfig } = require('../src/dbConfig');

async function main() {
  const dbName = process.env.DB_NAME || 'soundpay';

  // Connect WITHOUT choosing a database, because it may not exist yet.
  const connection = await mysql.createConnection({
    ...getDbConfig(),
    multipleStatements: true, // only safe here because we run our own file
  });

  // Identifiers can't be parameterised with "?", so we escape the name instead.
  await connection.query(`CREATE DATABASE IF NOT EXISTS ${mysql.escapeId(dbName)}`);
  await connection.query(`USE ${mysql.escapeId(dbName)}`);

  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await connection.query(schema);

  console.log(`Database "${dbName}" is ready.`);
  await connection.end();
}

main().catch((err) => {
  console.error('db:init failed:', err.message);
  process.exit(1);
});
