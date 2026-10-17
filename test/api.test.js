'use strict';
// Integration tests against a real PostgreSQL database.
// DATABASE_URL must point at a THROWAWAY database: tables are truncated.
//   DATABASE_URL=postgres://postgres@localhost:5432/pines_test npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pines-up-'));
process.env.GUEST_ORDER_LIMIT = '1000';
const request = require('supertest');
const WebSocket = require('ws');
const sharp = require('sharp');
const { pool } = require('../src/db');
const { migrate } = require('../db/migrate');
const { seed } = require('../db/seed');
const { createApp } = require('../src/app');
const realtime = require('../src/realtime');

let app, server, wss, base, tok = {};
const H = role => ({ Authorization: 'Bearer ' + tok[role] });

before(async () => {
  await migrate({ log: () => {} });
  await pool.query('TRUNCATE alerts, order_events, order_items, orders, staff_users, settings, menu_items RESTART IDENTITY CASCADE');
  await seed({ log: () => {} });
  app = createApp();
  server = http.createServer(app); wss = realtime.attach(server);
  await new Promise(r => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [role, pin] of [['admin', '1234'], ['kitchen', '1111'], ['service', '2222']]) {
    const r = await request(app).post('/api/v1/auth/login').send({ pin }).expect(200);
    assert.equal(r.body.staff.role, role);
    tok[role] = r.body.token;
  }
});
after(async () => {
  try {
    await pool.query('DELETE FROM order_events');
    await pool.query('DELETE FROM order_items');
    await pool.query('DELETE FROM alerts');
    await pool.query('DELETE FROM orders');
  } catch (_) {}
  wss.clients.forEach(c => c.terminate()); wss.close(); server.close(); await pool.end();
});

const guestOrder = (body) => request(app).post('/api/v1/orders').send(body);

test('health, menu and settings are public', async () => {
  await request(app).get('/api/v1/health').expect(200);
  const m = await request(app).get('/api/v1/menu').expect(200);
  assert.equal(m.body.length, 113);
  const thali = m.body.find(d => d.name === 'Pahari Dham Thali');
  assert.equal(thali.price, 650); assert.equal(thali.hero, 'photos/dham_thali_big.webp');
  const nvThali = m.body.find(d => d.name === 'Royal Non-Veg Feast Thali');
  assert.equal(nvThali.price, 790);
  const s = await request(app).get('/api/v1/settings').expect(200);
  assert.deepEqual(s.body.taxes.map(t => t.rate), [2.5, 2.5]);
  assert.equal(s.body.charges[0].rate, 5);
  assert.equal(s.body.pin, undefined);
});

test('wrong PIN is refused; staff routes need a token', async () => {
  await request(app).post('/api/v1/auth/login').send({ pin: '9999' }).expect(401);
  await request(app).get('/api/v1/orders').expect(401);
  await request(app).get('/api/v1/orders').set(H('kitchen')).expect(200);
  await request(app).put('/api/v1/settings').set(H('kitchen')).send({ rooms: '1' }).expect(403);
});

test('guest order: server prices, bill, code, tracking', async () => {
  const r = await guestOrder({ loc: { type: 'room', num: '102' }, note: 'less spicy',
    items: [{ id: 'pahari-dham-pahari-dham-thali', qty: 2, price: 1 }, { id: 'pahari-dham-pahari-dham-thali', qty: 1 }], priority: 'urgent' }).expect(201);
  const o = r.body;
  assert.match(o.code, /^[A-Z2-9]{4}$/);
  assert.equal(o.priority, 'normal', 'guests cannot set priority');
  assert.equal(o.source, 'guest');
  assert.equal(o.items.length, 1); assert.equal(o.items[0].qty, 3); assert.equal(o.items[0].price, 650);
  assert.equal(o.bill.subtotal, 1950);
  assert.equal(o.bill.taxes[0].amount, 48.75);
  assert.equal(o.bill.charges[0].amount, 97.5);
  assert.equal(o.bill.total, 1950 + 48.75 * 2 + 97.5);
  assert.ok(o.guestToken);
  const t = await request(app).get('/api/v1/orders/track').query({ tokens: o.guestToken }).expect(200);
  assert.equal(t.body.length, 1); assert.equal(t.body[0].id, o.id); assert.equal(t.body[0].guestToken, undefined);
  await request(app).get('/api/v1/orders/' + o.id).expect(404);
  await request(app).get('/api/v1/orders/' + o.id).set('X-Guest-Token', o.guestToken).expect(200);
  const al = await request(app).get('/api/v1/alerts').set(H('service')).expect(200);
  assert.equal(al.body[0].kind, 'new'); assert.equal(al.body[0].orderId, o.id);

  // order with guestName, guestPhone without explicit loc (universal QR flow)
  const g2 = await guestOrder({ guestName: 'Rohan Sharma', guestPhone: '9876543210',
    items: [{ id: 'royal-nonveg-thali', qty: 1 }] }).expect(201);
  assert.equal(g2.body.guestName, 'Rohan Sharma');
  assert.equal(g2.body.guestPhone, '9876543210');
  assert.equal(g2.body.loc.num, 'GUEST');
});

test('guest order validation: unknown room, unavailable dish, empty', async () => {
  await guestOrder({ loc: { type: 'room', num: '999' }, items: [{ id: 'pahari-dham-pahari-dham-thali', qty: 1 }] }).expect(400);
  await guestOrder({ loc: { type: 'table', num: '3' }, items: [] }).expect(400);
  await guestOrder({ loc: { type: 'table', num: '3' }, items: [{ id: 'nope', qty: 1 }] }).expect(409);
  await request(app).patch('/api/v1/menu/pahari-dham-pahari-dham-thali').set(H('admin')).send({ available: false }).expect(200);
  const r = await guestOrder({ loc: { type: 'table', num: '3' }, items: [{ id: 'pahari-dham-pahari-dham-thali', qty: 1 }] }).expect(409);
  assert.match(r.body.error.message, /Not available/);
  await request(app).patch('/api/v1/menu/pahari-dham-pahari-dham-thali').set(H('admin')).send({ available: true }).expect(200);
});

test('kitchen → serve → waiter flow, re-prepare, auto-complete and reopen', async () => {
  const menu = (await request(app).get('/api/v1/menu')).body;
  const a = menu.find(d => d.name === 'Butter Chicken') || menu[5]; const b = menu.find(d => d.name === 'Garlic Naan') || menu[6];
  const o = (await request(app).post('/api/v1/orders').set(H('service')).send({ loc: { type: 'table', num: '4' }, priority: 'urgent',
    items: [{ id: a.id, qty: 1 }, { id: b.id, qty: 2 }] }).expect(201)).body;
  assert.equal(o.source, 'waiter'); assert.equal(o.priority, 'urgent'); assert.equal(o.guestToken, undefined);
  const [k1, k2] = o.items.map(i => i.k);
  const P = (role, body) => request(app).patch(`/api/v1/orders/${o.id}/items`).set(H(role)).send(body);

  await P('service', { keys: [k1], status: 'preparing' }).expect(403);            // waiters don't cook
  await P('kitchen', { keys: [k1, k2], status: 'preparing' }).expect(200);
  await P('kitchen', { keys: [k1], status: 'served' }).expect(403);               // kitchen calls the waiter instead
  await P('service', { keys: [k1], status: 'served' }).expect(409);               // not ready yet
  let r = await P('kitchen', { keys: [k1, k2], status: 'ready' }).expect(200);
  assert.deepEqual(r.body.items.map(i => i.status), ['ready', 'ready']);
  let al = (await request(app).get('/api/v1/alerts').set(H('service'))).body;
  assert.equal(al[0].kind, 'serve'); assert.match(al[0].text, /^Serve now: 1× /);

  await P('service', { keys: [k1], status: 'served' }).expect(200);
  r = await P('service', { keys: [k2], status: 'served' }).expect(200);
  assert.equal(r.body.status, 'completed'); assert.ok(r.body.completedAt);
  r = await P('service', { keys: [k2], status: 'served' }).expect(200);           // repeat is harmless

  r = await P('service', { keys: [k2], status: 'reprepare' }).expect(200);        // guest sent it back
  assert.equal(r.body.status, 'open'); assert.equal(r.body.completedAt, null);
  assert.equal(r.body.items[1].redo, 1);
  al = (await request(app).get('/api/v1/alerts').set(H('kitchen'))).body;
  assert.equal(al[0].kind, 'reprepare'); assert.match(al[0].text, /^RE-PREPARE: 2× /);
  await P('kitchen', { keys: [k2], status: 'preparing' }).expect(200);

  const ev = (await request(app).get(`/api/v1/orders/${o.id}/events`).set(H('admin')).expect(200)).body;
  assert.ok(ev.some(e => e.action === 'reopen'));
  assert.ok(ev.every(e => e.at > 0));
});

test('bulk action skips dishes that cannot move', async () => {
  const menu = (await request(app).get('/api/v1/menu')).body;
  const o = (await request(app).post('/api/v1/orders').set(H('admin')).send({ loc: { type: 'room', num: '101' },
    items: [{ id: menu[1].id, qty: 1 }, { id: menu[2].id, qty: 1 }] }).expect(201)).body;
  const [k1, k2] = o.items.map(i => i.k);
  await request(app).patch(`/api/v1/orders/${o.id}/items`).set(H('admin')).send({ keys: [k1], status: 'served' }).expect(200);
  const r = await request(app).patch(`/api/v1/orders/${o.id}/items`).set(H('kitchen')).send({ keys: [k1, k2], status: 'prepared' }).expect(200);
  assert.deepEqual(r.body.items.map(i => i.status), ['served', 'prepared']);
  assert.deepEqual(r.body.skipped, [k1]);
});

test('priority rules, cancel and complete', async () => {
  const menu = (await request(app).get('/api/v1/menu')).body;
  const o = (await guestOrder({ loc: { type: 'room', num: '105' }, items: [{ id: menu[3].id, qty: 1 }] }).expect(201)).body;
  await request(app).patch('/api/v1/orders/' + o.id).set(H('kitchen')).send({ priority: 'urgent' }).expect(403);
  let r = await request(app).patch('/api/v1/orders/' + o.id).set(H('service')).send({ priority: 'fast' }).expect(200);
  assert.equal(r.body.priority, 'fast');
  await request(app).patch(`/api/v1/orders/${o.id}/items`).set(H('kitchen')).send({ keys: [o.items[0].k], status: 'preparing' }).expect(200);
  await request(app).patch('/api/v1/orders/' + o.id).set(H('service')).send({ priority: 'urgent' }).expect(403);
  r = await request(app).patch('/api/v1/orders/' + o.id).set(H('admin')).send({ priority: 'urgent' }).expect(200);
  assert.equal(r.body.priority, 'urgent');
  await request(app).patch('/api/v1/orders/' + o.id).set(H('admin')).send({ priority: 'asap' }).expect(400);
  const al = (await request(app).get('/api/v1/alerts').set(H('admin'))).body;
  assert.equal(al[0].kind, 'priority'); assert.equal(al[0].text, 'Priority set to Urgent');

  await request(app).post(`/api/v1/orders/${o.id}/cancel`).set(H('service')).expect(403);
  r = await request(app).post(`/api/v1/orders/${o.id}/cancel`).set(H('admin')).send({ reason: 'guest left' }).expect(200);
  assert.equal(r.body.status, 'cancelled');
  await request(app).patch(`/api/v1/orders/${o.id}/items`).set(H('kitchen')).send({ keys: [o.items[0].k], status: 'ready' }).expect(409);

  const o2 = (await guestOrder({ loc: { type: 'table', num: '1' }, items: [{ id: menu[4].id, qty: 2 }] }).expect(201)).body;
  r = await request(app).post(`/api/v1/orders/${o2.id}/complete`).set(H('admin')).expect(200);
  assert.equal(r.body.status, 'completed'); assert.ok(r.body.items.every(i => i.status === 'served'));
});

test('history, search, CSV and stats', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const all = (await request(app).get('/api/v1/orders').query({ date: today }).set(H('admin')).expect(200)).body;
  assert.ok(all.length >= 5);
  const done = (await request(app).get('/api/v1/orders').query({ date: today, status: 'completed' }).set(H('admin'))).body;
  assert.ok(done.every(o => o.status === 'completed'));
  const q = (await request(app).get('/api/v1/orders').query({ q: '105' }).set(H('admin'))).body;
  assert.ok(q.length >= 1 && q.every(o => o.loc.num.includes('105') || o.code.includes('105') || o.items.some(i => i.name.includes('105'))));
  const none = (await request(app).get('/api/v1/orders').query({ date: '2001-01-01' }).set(H('admin'))).body;
  assert.equal(none.length, 0);
  const csv = await request(app).get('/api/v1/orders/export.csv').query({ date: today }).set(H('admin')).expect(200);
  assert.match(csv.headers['content-type'], /text\/csv/); assert.match(csv.text, /Code,Placed,Location/);
  const s = (await request(app).get('/api/v1/stats/today').set(H('kitchen')).expect(200)).body;
  assert.equal(s.received, all.length); assert.ok(s.completed >= 1); assert.equal(s.cancelled, 1);
  assert.ok(s.billed > 0); assert.ok(s.topDishes.length > 0); assert.ok(s.reprepared >= 1);
  const rg = (await request(app).get('/api/v1/stats/range').query({ from: today, to: today }).set(H('admin')).expect(200)).body;
  assert.equal(rg[0].received, s.received);
});

test('settings: taxes & service charge change the next bill only', async () => {
  const menu = (await request(app).get('/api/v1/menu')).body;
  const before = (await guestOrder({ loc: { type: 'table', num: '2' }, items: [{ id: menu[0].id, qty: 1 }] })).body;
  await request(app).put('/api/v1/settings').set(H('admin')).send({ taxes: [{ name: 'GST', rate: 18 }], charges: [] }).expect(200);
  await request(app).put('/api/v1/settings').set(H('admin')).send({ taxes: [{ name: 'GST', rate: 180 }] }).expect(400);
  await request(app).put('/api/v1/settings').set(H('admin')).send({ pin: '0000' }).expect(400);
  const after = (await guestOrder({ loc: { type: 'table', num: '2' }, items: [{ id: menu[0].id, qty: 1 }] })).body;
  assert.equal(after.bill.taxes[0].rate, 18); assert.equal(after.bill.charges.length, 0);
  assert.equal(after.bill.total, Math.round(menu[0].price * 1.18 * 100) / 100);
  const again = (await request(app).get('/api/v1/orders/' + before.id).set(H('admin'))).body;
  assert.equal(again.bill.taxes.length, 2, 'old bills are frozen');
  const s = (await request(app).put('/api/v1/settings').set(H('admin')).send({ rooms: '101-103', tables: '1-2', menuLink: 'https://menu.example.com/' }).expect(200)).body;
  assert.equal(s.rooms, '101-103'); assert.equal(s.taxes[0].name, 'GST');
  await guestOrder({ loc: { type: 'room', num: '105' }, items: [{ id: menu[0].id, qty: 1 }] }).expect(400);
  await request(app).put('/api/v1/settings').set(H('admin')).send({ taxes: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }], charges: [{ name: 'Service charge', rate: 5 }], rooms: '101-106', tables: '1-8', menuLink: 'http://10.128.208.161:8080/' }).expect(200);
});

test('content management: create, edit, photo upload, delete', async () => {
  const png = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#a0522d' } }).png().toBuffer();
  const dataUrl = 'data:image/png;base64,' + png.toString('base64');
  let r = await request(app).post('/api/v1/menu').set(H('admin')).send({ name: 'Trout Amritsari', section: 'Chef’s Specials', price: 720, veg: false, desc: 'Local trout', img: dataUrl }).expect(201);
  const d = r.body;
  assert.match(d.id, /^chef-s-special.*trout-amritsari-/); assert.match(d.img, /^\/uploads\/.+\.webp$/);
  const img = await request(app).get(d.img).expect(200);
  const meta = await sharp(img.body).metadata(); assert.equal(meta.format, 'webp'); assert.ok(meta.width <= 640);
  r = await request(app).patch('/api/v1/menu/' + d.id).set(H('admin')).send({ price: 760, signature: true }).expect(200);
  assert.equal(r.body.price, 760);
  await request(app).patch('/api/v1/menu/' + d.id).set(H('admin')).send({ price: -1 }).expect(400);
  await request(app).patch('/api/v1/menu/' + d.id).set(H('admin')).send({ colour: 'red' }).expect(400);
  await request(app).patch('/api/v1/menu/' + d.id).set(H('kitchen')).send({ price: 1 }).expect(403);
  r = await request(app).post(`/api/v1/menu/${d.id}/photo`).query({ kind: 'hero' }).set(H('admin')).attach('photo', png, 'big.png').expect(200);
  assert.match(r.body.hero, /-hero-/);
  await request(app).post(`/api/v1/menu/${d.id}/photo`).set(H('admin')).attach('photo', Buffer.from('not an image'), 'x.png').expect(400);
  r = await request(app).put('/api/v1/menu/my-new-dish').set(H('admin')).send({ name: 'My dish', section: 'Desserts', price: 99 }).expect(200);
  assert.equal(r.body.id, 'my-new-dish');
  r = await request(app).delete(`/api/v1/menu/${d.id}/photo`).set(H('admin')).expect(200);
  assert.equal(r.body.img, ''); assert.equal(r.body.hero, '');
  await request(app).get(d.img).expect(404);                                     // old file removed
  await request(app).delete('/api/v1/menu/' + d.id).set(H('admin')).expect(204);
  await request(app).delete('/api/v1/menu/my-new-dish').set(H('admin')).expect(204);
  await request(app).get('/api/v1/menu/' + d.id).expect(404);
  await request(app).delete('/api/v1/menu/indian-vegetar-starte-paneer-tikka').set(H('admin'));          // a seeded dish
  await seed({ log: () => {} });                                                              // e.g. a restart
  const n = (await request(app).get('/api/v1/menu')).body.length;
  assert.ok(!(await request(app).get('/api/v1/menu')).body.some(x => x.id === 'indian-vegetar-starte-paneer-tikka'), 'deleted dishes stay deleted');
  assert.ok(n >= 110);
});

test('staff management and PIN changes', async () => {
  let r = await request(app).post('/api/v1/staff').set(H('admin')).send({ name: 'Ravi', role: 'service', pin: '4321', phone: '9876543210', designation: 'Captain / Waiter' }).expect(201);
  const ravi = r.body;
  assert.equal(ravi.phone, '9876543210');
  assert.equal(ravi.designation, 'Captain / Waiter');
  await request(app).post('/api/v1/staff').set(H('admin')).send({ name: 'Dup', role: 'kitchen', pin: '1111' }).expect(409);
  await request(app).post('/api/v1/staff').set(H('service')).send({ name: 'X', role: 'admin', pin: '7777' }).expect(403);
  const login = (await request(app).post('/api/v1/auth/login').send({ pin: '4321' }).expect(200)).body;
  await request(app).put('/api/v1/auth/pin').set({ Authorization: 'Bearer ' + login.token }).send({ currentPin: '0000', newPin: '5555' }).expect(401);
  await request(app).put('/api/v1/auth/pin').set({ Authorization: 'Bearer ' + login.token }).send({ currentPin: '4321', newPin: '5555' }).expect(200);
  await request(app).post('/api/v1/auth/login').send({ pin: '5555' }).expect(200);
  await request(app).patch('/api/v1/staff/' + ravi.id).set(H('admin')).send({ active: false }).expect(200);
  await request(app).get('/api/v1/orders').set({ Authorization: 'Bearer ' + login.token }).expect(401);   // disabled at once
  await request(app).post('/api/v1/auth/login').send({ pin: '5555' }).expect(401);
  const list = (await request(app).get('/api/v1/staff').set(H('admin'))).body;
  assert.ok(list.find(s => s.name === 'Ravi' && !s.active)); assert.equal(list[0].pin_hash, undefined);
  const me = (await request(app).get('/api/v1/auth/me').set(H('admin'))).body;
  r = await request(app).patch('/api/v1/staff/' + me.id).set(H('admin')).send({ active: false }).expect(400);
  assert.match(r.body.error.message, /at least one active admin/);
});

test('realtime: staff get everything, guests only their own order and menu', async () => {
  const open = url => new Promise((res, rej) => { const ws = new WebSocket(url); const got = []; ws.on('message', m => got.push(JSON.parse(m))); ws.on('open', () => res({ ws, got })); ws.on('error', rej); });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const staffWs = await open(base.replace('http', 'ws') + '/ws?token=' + tok.kitchen);
  const guestWs = await open(base.replace('http', 'ws') + '/ws');
  const otherGuest = await open(base.replace('http', 'ws') + '/ws');
  await new Promise((res, rej) => { const ws = new WebSocket(base.replace('http', 'ws') + '/ws?token=bad'); ws.on('close', c => (c === 4401 ? res() : rej(new Error('code ' + c)))); ws.on('error', () => {}); });
  const menu = (await request(app).get('/api/v1/menu')).body;
  const o = (await guestOrder({ loc: { type: 'room', num: '103' }, items: [{ id: menu[0].id, qty: 1 }] }).expect(201)).body;
  guestWs.ws.send(JSON.stringify({ type: 'track', tokens: [o.guestToken] }));
  await wait(150);
  await request(app).patch(`/api/v1/orders/${o.id}/items`).set(H('kitchen')).send({ keys: [o.items[0].k], status: 'ready' }).expect(200);
  await request(app).patch('/api/v1/menu/' + menu[0].id).set(H('admin')).send({ price: menu[0].price + 1 }).expect(200);
  await wait(250);
  const types = l => l.got.map(m => m.type);
  assert.ok(types(staffWs).includes('order.created')); assert.ok(types(staffWs).includes('alert.created'));
  assert.ok(types(staffWs).includes('order.updated'));
  assert.ok(types(guestWs).includes('order.updated')); assert.ok(types(guestWs).includes('menu.updated'));
  assert.ok(!types(guestWs).includes('alert.created')); assert.ok(!types(guestWs).includes('order.created'));
  assert.ok(!types(otherGuest).includes('order.updated'));
  const upd = guestWs.got.find(m => m.type === 'order.updated');
  assert.equal(upd.data.items[0].status, 'ready');
  [staffWs, guestWs, otherGuest].forEach(x => x.ws.close());
  await request(app).patch('/api/v1/menu/' + menu[0].id).set(H('admin')).send({ price: menu[0].price }).expect(200);
});

test('pages are served with the API switch injected', async () => {
  const pub = path.join(__dirname, '..', 'public', 'index.html');
  if (!fs.existsSync(pub)) return;
  const r = await request(app).get('/kitchen').expect(200);
  assert.match(r.text, /window\.PE_API=\{base:'\/api\/v1'\};window\.__START_ROUTE='kitchen'/);
  assert.match(r.headers['content-security-policy'], /connect-src 'self' ws: wss:/);
});
