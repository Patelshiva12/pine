'use strict';
// Staff sign in with a 4–6 digit PIN only (fast on a shared kitchen tablet), so PINs must be
// unique among active staff. Each person/role should get their own PIN.
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { query } = require('../db');
const { parse, notFound, conflict, unauthorized, bad } = require('../errors');
const auth = require('../auth');

const Pin = z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits');
const Role = z.enum(['admin', 'kitchen', 'service']);
const NewStaff = z.object({
  name: z.string().trim().min(1).max(60),
  role: Role,
  pin: Pin,
  phone: z.string().trim().max(20).optional().default(''),
  designation: z.string().trim().max(60).optional().default(''),
}).strict();
const PatchStaff = z.object({
  name: z.string().trim().min(1).max(60),
  role: Role,
  pin: Pin,
  active: z.boolean(),
  phone: z.string().trim().max(20),
  designation: z.string().trim().max(60),
}).partial().strict();

const toApi = r => ({ id: r.id, name: r.name, role: r.role, active: r.active,
  phone: r.phone || '', designation: r.designation || '',
  lastLogin: r.last_login ? new Date(r.last_login).getTime() : null, createdAt: new Date(r.created_at).getTime() });

async function activeUsers() {
  return (await query('SELECT id,name,role,pin_hash,phone,designation,active,last_login,created_at FROM staff_users WHERE active')).rows;
}
async function findByPin(pin, users) {
  for (const u of users || await activeUsers()) if (await bcrypt.compare(pin, u.pin_hash)) return u;
  return null;
}
async function assertPinFree(pin, exceptId) {
  const u = await findByPin(pin);
  if (u && u.id !== exceptId) throw conflict('That PIN is already used by another staff member');
}

async function login(body) {
  const { pin } = parse(z.object({ pin: z.string().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits') }), body);
  const u = await findByPin(pin);
  if (!u) throw unauthorized('That PIN did not match');
  await query('UPDATE staff_users SET last_login=now() WHERE id=$1', [u.id]);
  return { token: auth.sign(u), staff: toApi(u) };
}

async function list() {
  return (await query('SELECT id,name,role,phone,designation,active,last_login,created_at FROM staff_users ORDER BY active DESC, role, name')).rows.map(toApi);
}
async function create(body) {
  const d = parse(NewStaff, body);
  await assertPinFree(d.pin);
  const { rows } = await query('INSERT INTO staff_users(name,role,pin_hash,phone,designation) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [d.name, d.role, await bcrypt.hash(d.pin, 10), d.phone || '', d.designation || '']);
  return toApi(rows[0]);
}
async function update(id, body, actor) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Staff member');
  const d = parse(PatchStaff, body);
  const cur = (await query('SELECT * FROM staff_users WHERE id=$1', [id])).rows[0];
  if (!cur) throw notFound('Staff member');
  if (d.pin) await assertPinFree(d.pin, id);
  // never lock everyone out: keep at least one active admin
  const losingAdmin = cur.role === 'admin' && cur.active && (d.active === false || (d.role && d.role !== 'admin'));
  if (losingAdmin) {
    const { rows } = await query("SELECT count(*)::int AS n FROM staff_users WHERE role='admin' AND active AND id<>$1", [id]);
    if (!rows[0].n) throw bad('Keep at least one active admin');
  }
  const sets = []; const vals = [];
  if (d.name) { vals.push(d.name); sets.push(`name=$${vals.length}`); }
  if (d.role) { vals.push(d.role); sets.push(`role=$${vals.length}`); }
  if (d.phone !== undefined) { vals.push(d.phone); sets.push(`phone=$${vals.length}`); }
  if (d.designation !== undefined) { vals.push(d.designation); sets.push(`designation=$${vals.length}`); }
  if (d.active !== undefined) { vals.push(d.active); sets.push(`active=$${vals.length}`); }
  if (d.pin) { vals.push(await bcrypt.hash(d.pin, 10)); sets.push(`pin_hash=$${vals.length}`); }
  if (!sets.length) return toApi(cur);
  vals.push(id);
  const { rows } = await query(`UPDATE staff_users SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length} RETURNING *`, vals);
  return toApi(rows[0]);
}
/** Signed-in staff changes their own PIN */
async function changeOwnPin(staffId, body) {
  const d = parse(z.object({ currentPin: Pin, newPin: Pin }).strict(), body);
  const cur = (await query('SELECT * FROM staff_users WHERE id=$1 AND active', [staffId])).rows[0];
  if (!cur || !(await bcrypt.compare(d.currentPin, cur.pin_hash))) throw unauthorized('Current PIN is wrong');
  await assertPinFree(d.newPin, staffId);
  await query('UPDATE staff_users SET pin_hash=$1, updated_at=now() WHERE id=$2', [await bcrypt.hash(d.newPin, 10), staffId]);
  return { ok: true };
}
async function me(staffId) {
  const r = (await query('SELECT * FROM staff_users WHERE id=$1 AND active', [staffId])).rows[0];
  if (!r) throw unauthorized('This login is no longer active');
  return toApi(r);
}

async function remove(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Staff member');
  const cur = (await query('SELECT * FROM staff_users WHERE id=$1', [id])).rows[0];
  if (!cur) throw notFound('Staff member');
  if (cur.role === 'admin' && cur.active) {
    const { rows } = await query("SELECT count(*)::int AS n FROM staff_users WHERE role='admin' AND active AND id<>$1", [id]);
    if (!rows[0].n) throw bad('Keep at least one active admin');
  }
  await query('DELETE FROM staff_users WHERE id=$1', [id]);
  return { ok: true };
}

module.exports = { login, list, create, update, remove, changeOwnPin, me };

