'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const api = require('./routes/api');
const { ApiError } = require('./errors');

function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
        'script-src-attr': ["'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  if (config.corsOrigins.length) app.use('/api', cors({ origin: config.corsOrigins, credentials: false }));
  app.use(express.json({ limit: '12mb' }));    // dish photos may arrive as data URLs

  app.use('/api/v1', api);
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'No such API route' } }));

  // uploaded dish photos
  app.use(config.uploadUrl, express.static(config.uploadDir, { maxAge: '30d', immutable: true, fallthrough: false }));

  // The four pages are one front-end app; each address opens on its own page.
  const PAGES = { '/': null, '/menu': null, '/kitchen': 'kitchen', '/service': 'service', '/admin': 'admin' };
  let shell = null;
  const indexFile = path.join(config.publicDir, 'index.html');
  function page(start) {
    if (!shell || !config.isProd) shell = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8') : null;
    if (!shell) return null;
    const inject = `<script>window.PE_API={base:'/api/v1'};${start ? `window.__START_ROUTE='${start}';` : ''}</script>`;
    return shell.includes('<head>') ? shell.replace('<head>', '<head>' + inject) : inject + shell;
  }
  for (const [p, start] of Object.entries(PAGES)) {
    app.get(p, (_req, res) => {
      const html = page(start);
      if (!html) return res.status(503).send('Front-end not installed: put index.html in ' + config.publicDir);
      res.set('Cache-Control', 'no-cache').type('html').send(html);
    });
  }
  app.use(express.static(config.publicDir, { maxAge: config.isProd ? '7d' : 0, index: false }));

  // errors -> {error:{code,message,details?}}
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'Body is not valid JSON' } });
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'Request is too large' } });
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { code: 'too_large', message: 'Photo is too large' } });
    if (err && err.status === 404) return res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
    if (err && err.code === '23505') return res.status(409).json({ error: { code: 'conflict', message: 'That already exists' } });
    console.error('[api]', err);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server' } });
  });
  return app;
}
module.exports = { createApp };
