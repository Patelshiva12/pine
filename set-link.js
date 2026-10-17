const { pool } = require('./src/db');
async function main() {
  const link = 'http://10.128.208.161:8080/';
  const res = await pool.query(
    'UPDATE settings SET value = jsonb_set(value, \'{menuLink}\', to_jsonb($1::text)) WHERE key = $2 RETURNING value',
    [link, 'access']
  );
  console.log('Result:', res.rows[0].value);
  await pool.end();
}
main().catch(console.error);
