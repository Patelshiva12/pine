'use strict';
require('dotenv').config();
const path = require('path');

const env = process.env;
const isProd = env.NODE_ENV === 'production';

const config = {
  isProd,
  port: Number(env.PORT || 8080),
  databaseUrl: env.DATABASE_URL || 'postgres://postgres@localhost:5432/pines',
  jwtSecret: env.JWT_SECRET || (isProd ? null : 'dev-only-secret-change-me'),
  jwtTtl: env.JWT_TTL || '12h',
  timezone: env.APP_TZ || 'Asia/Kolkata',          // used for "today" and history by date
  publicDir: path.resolve(env.PUBLIC_DIR || path.join(__dirname, '..', 'public')),
  uploadDir: path.resolve(env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads')),
  uploadUrl: '/uploads',
  publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),   // set when pages are hosted on another domain
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY || 'loopback',
  maxPhotoBytes: Number(env.MAX_PHOTO_MB || 8) * 1024 * 1024,
  guestOrderLimitPerMin: Number(env.GUEST_ORDER_LIMIT || 6),
};

if (!config.jwtSecret) {
  throw new Error('JWT_SECRET must be set in production');
}
module.exports = config;
