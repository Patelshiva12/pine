'use strict';
// Staff notifications: new order, "Serve dish" (ready at the pass), RE-PREPARE, priority change, cancel.
// Created by the orders service inside the same transaction as the change that caused them.
const { query } = require('../db');

const toApi = r => ({ id: 'a' + r.id, kind: r.kind, orderId: r.order_id, code: r.code,
  loc: r.loc_type ? { type: r.loc_type, num: r.loc_num } : null, text: r.text, at: new Date(r.created_at).getTime() });

async function add(c, a) {
  const { rows } = await c.query(`INSERT INTO alerts(kind,order_id,code,loc_type,loc_num,text) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [a.kind, a.orderId || null, a.code || null, a.loc ? a.loc.type : null, a.loc ? a.loc.num : null, String(a.text).slice(0, 500)]);
  return toApi(rows[0]);
}
async function list({ limit = 40, since } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 40));
  const vals = [lim]; let where = '';
  if (since && Number(since) > 0) { vals.push(new Date(Number(since))); where = 'WHERE created_at > $2'; }
  const { rows } = await query(`SELECT * FROM alerts ${where} ORDER BY created_at DESC, id DESC LIMIT $1`, vals);
  return rows.map(toApi);
}
/** Housekeeping: keep 90 days of alerts (orders and their audit trail are kept). */
async function prune(days = 90) {
  const r = await query(`DELETE FROM alerts WHERE created_at < now() - ($1 || ' days')::interval`, [String(days)]);
  return r.rowCount;
}
module.exports = { add, list, prune };
