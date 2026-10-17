'use strict';
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { ah, bad } = require('../errors');
const { optionalAuth, requireRole } = require('../auth');
const { query } = require('../db');
const menu = require('../services/menu');
const settings = require('../services/settings');
const orders = require('../services/orders');
const alerts = require('../services/alerts');
const staff = require('../services/staff');
const stats = require('../services/stats');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxPhotoBytes, files: 1 } });
const any = requireRole();
const admin = requireRole('admin');

// A token stays valid only while its staff login is active (checked at most every 30 s per user).
const activeCache = new Map();
async function stillActive(req, _res, next) {
  if (!req.staff) return next();
  const hit = activeCache.get(req.staff.id);
  if (hit && hit.until > Date.now()) { if (!hit.ok) req.staff = null; return next(); }
  try {
    const { rows } = await query('SELECT role, active FROM staff_users WHERE id=$1', [req.staff.id]);
    const ok = !!(rows[0] && rows[0].active && rows[0].role === req.staff.role);
    activeCache.set(req.staff.id, { ok, until: Date.now() + 30_000 });
    if (!ok) req.staff = null;
    next();
  } catch (e) { next(e); }
}
r.use(optionalAuth, ah(stillActive));
r.clearActiveCache = () => activeCache.clear();

const loginLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: { code: 'rate_limited', message: 'Too many PIN attempts. Wait a minute.' } } });
const guestOrderLimiter = rateLimit({ windowMs: 60_000, limit: config.guestOrderLimitPerMin, standardHeaders: 'draft-7', legacyHeaders: false,
  skip: req => !!req.staff, message: { error: { code: 'rate_limited', message: 'Too many orders from this device. Please ask a waiter.' } } });

// ---------------------------------------------------------------- health
r.get('/openapi.yaml', (_req, res) => res.type('text/yaml').sendFile(require('path').join(__dirname, '..', '..', 'openapi.yaml')));
r.get('/health', ah(async (_req, res) => { await query('SELECT 1'); res.json({ ok: true, time: Date.now() }); }));

// ---------------------------------------------------------------- auth & staff
r.post('/auth/login', loginLimiter, ah(async (req, res) => res.json(await staff.login(req.body))));
r.get('/auth/me', any, ah(async (req, res) => res.json(await staff.me(req.staff.id))));
r.put('/auth/pin', any, ah(async (req, res) => { const out = await staff.changeOwnPin(req.staff.id, req.body); activeCache.clear(); res.json(out); }));
r.get('/staff', admin, ah(async (_req, res) => res.json(await staff.list())));
r.post('/staff', admin, ah(async (req, res) => res.status(201).json(await staff.create(req.body))));
r.patch('/staff/:id', admin, ah(async (req, res) => { const out = await staff.update(req.params.id, req.body, req.staff); activeCache.clear(); res.json(out); }));
r.delete('/staff/:id', admin, ah(async (req, res) => { await staff.remove(req.params.id); activeCache.clear(); res.status(204).end(); }));


// ---------------------------------------------------------------- menu & content management
r.get('/menu', ah(async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.json(await menu.list({ availableOnly: req.query.available === 'true' }));
}));
r.get('/menu/:id', ah(async (req, res) => res.json(await menu.get(req.params.id))));
r.post('/menu', admin, ah(async (req, res) => res.status(201).json(await menu.create(req.body))));
r.put('/menu/:id', admin, ah(async (req, res) => res.json(await menu.upsert(req.params.id, req.body))));
r.patch('/menu/:id', admin, ah(async (req, res) => res.json(await menu.patch(req.params.id, req.body))));
r.delete('/menu/:id', admin, ah(async (req, res) => { await menu.remove(req.params.id); res.status(204).end(); }));
// multipart/form-data, field "photo"; ?kind=hero for the large feature photo
r.post('/menu/:id/photo', admin, upload.single('photo'), ah(async (req, res) => {
  if (!req.file) throw bad('Attach an image in the "photo" field');
  res.json(await menu.setPhoto(req.params.id, req.file.buffer, req.query.kind === 'hero' ? 'hero' : 'img'));
}));
r.delete('/menu/:id/photo', admin, ah(async (req, res) => res.json(await menu.clearPhoto(req.params.id, req.query.kind === 'hero' ? 'hero' : 'img'))));

// ---------------------------------------------------------------- settings (taxes, service charges, rooms/tables, menu link)
r.get('/settings', ah(async (_req, res) => res.json(await settings.getPublic())));
r.put('/settings', admin, ah(async (req, res) => res.json(await settings.update(req.body))));

// ---------------------------------------------------------------- orders
r.post('/orders', guestOrderLimiter, ah(async (req, res) => res.status(201).json(await orders.create(req.body, req.staff))));
r.get('/orders/track', ah(async (req, res) => res.json(await orders.track(req.query.tokens))));
r.get('/orders', any, ah(async (req, res) => res.json(await orders.list(req.query))));
r.get('/orders/export.csv', admin, ah(async (req, res) => {
  const list = await orders.list({ ...req.query, limit: 2000 });
  const esc = v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const fmt = t => (t ? new Date(t).toLocaleString('en-IN', { timeZone: config.timezone }) : '');
  const head = ['Code', 'Placed', 'Location', 'Source', 'Priority', 'Status', 'Dishes', 'Subtotal', 'Taxes', 'Charges', 'Total', 'Completed', 'Note'];
  const rows = list.map(o => [o.code, fmt(o.createdAt), `${o.loc.type} ${o.loc.num}`, o.source, o.priority, o.status,
    o.items.map(i => `${i.qty}x ${i.name}`).join('; '), o.bill.subtotal, o.bill.taxes.reduce((s, t) => s + t.amount, 0).toFixed(2),
    o.bill.charges.reduce((s, t) => s + t.amount, 0).toFixed(2), o.bill.total, fmt(o.completedAt), o.note]);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="orders-${req.query.date || req.query.from || 'recent'}.csv"`);
  res.send('﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n'));
}));
r.get('/orders/:id', ah(async (req, res) => {
  const o = await orders.get(req.params.id);
  if (!req.staff) {   // guests may read their own order with its token
    const t = req.get('X-Guest-Token') || req.query.token;
    if (!t || t !== (await orders.guestTokenOf(o.id))) return res.status(404).json({ error: { code: 'not_found', message: 'Order not found' } });
  }
  res.json(o);
}));
r.get('/orders/:id/events', any, ah(async (req, res) => res.json(await orders.eventsOf(req.params.id))));
r.patch('/orders/:id/items', any, ah(async (req, res) => res.json(await orders.setItems(req.params.id, req.body, req.staff))));
r.patch('/orders/:id', any, ah(async (req, res) => res.json(await orders.setPriority(req.params.id, req.body, req.staff))));
r.post('/orders/:id/cancel', admin, ah(async (req, res) => res.json(await orders.cancel(req.params.id, req.staff, req.body))));
r.post('/orders/:id/complete', admin, ah(async (req, res) => res.json(await orders.complete(req.params.id, req.staff))));
r.post('/orders/clear-all', admin, ah(async (_req, res) => res.json(await orders.clearAll())));

// ---------------------------------------------------------------- notifications & reports
r.get('/alerts', any, ah(async (req, res) => res.json(await alerts.list(req.query))));
r.get('/stats/today', any, ah(async (_req, res) => res.json(await stats.day())));
r.get('/stats/day/:date', admin, ah(async (req, res) => res.json(await stats.day(req.params.date))));
r.get('/stats/range', admin, ah(async (req, res) => res.json(await stats.range(req.query.from, req.query.to))));

module.exports = r;
