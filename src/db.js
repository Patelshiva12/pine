'use strict';
const { Pool, types } = require('pg');
const config = require('./config');

// numeric -> JS number (prices fit comfortably), int8 (bigserial ids) -> number
types.setTypeParser(1700, v => (v === null ? null : Number(v)));
types.setTypeParser(20, v => (v === null ? null : Number(v)));

const pool = new Pool({ connectionString: config.databaseUrl, max: Number(process.env.PG_POOL || 10) });
pool.on('error', err => console.error('[pg] idle client error', err.message));

const query = (text, params) => pool.query(text, params);

/** Run fn(client) inside a transaction. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
