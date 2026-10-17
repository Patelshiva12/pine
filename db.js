const { Pool, Client } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'pine_resort_db',
};

let pool = new Pool(dbConfig);

// Helper to ensure database & tables exist
async function initializeDatabase() {
  const adminClient = new Client({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: 'postgres',
  });

  try {
    await adminClient.connect();
    // Check if target database exists
    const checkRes = await adminClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbConfig.database]
    );

    if (checkRes.rowCount === 0) {
      console.log(`[DB] Database "${dbConfig.database}" does not exist. Creating now...`);
      await adminClient.query(`CREATE DATABASE "${dbConfig.database}"`);
      console.log(`[DB] Database "${dbConfig.database}" created successfully!`);
    }
  } catch (err) {
    console.warn(`[DB Admin Warning] Could not check/create database via 'postgres': ${err.message}`);
  } finally {
    try { await adminClient.end(); } catch (e) {}
  }

  // Connect to target database and run schema.sql
  pool = new Pool(dbConfig);
  try {
    const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schemaSql);
    console.log('[DB] PostgreSQL schema verified / created successfully!');
  } catch (err) {
    console.error(`[DB Error] Failed to initialize schema: ${err.message}`);
    throw err;
  }
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  initializeDatabase,
};
