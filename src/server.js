'use strict';
const http = require('http');
const config = require('./config');
const { createApp } = require('./app');
const realtime = require('./realtime');
const { migrate } = require('../db/migrate');
const { seed } = require('../db/seed');
const { pool } = require('./db');
const alerts = require('./services/alerts');

async function main() {
  if (process.env.AUTO_MIGRATE !== 'false') { await migrate(); await seed(); }
  const server = http.createServer(createApp());
  realtime.attach(server);
  server.listen(config.port, () => console.log(`[pines] listening on :${config.port}  (pages: /  /kitchen  /service  /admin · API: /api/v1)`));
  const prune = setInterval(() => alerts.prune().catch(() => {}), 6 * 3600 * 1000);
  const stop = () => { clearInterval(prune); server.close(() => pool.end().then(() => process.exit(0))); setTimeout(() => process.exit(0), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
main().catch(e => { console.error(e); process.exit(1); });
