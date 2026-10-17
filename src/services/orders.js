'use strict';
// Orders: creation (guest QR menu or waiter), dish status flow, priority, cancel/complete,
// history and guest tracking. All money is recomputed here from the database menu & settings;
// prices sent by a browser are never trusted.
const { z } = require('zod');
const { query, tx } = require('../db');
const { parse, bad, notFound, conflict, forbidden } = require('../errors');
const bus = require('../bus');
const ids = require('../ids');
const { computeBill } = require('../billing');
const settings = require('./settings');
const alerts = require('./alerts');
const config = require('../config');

const PRIORITIES = ['urgent', 'priority', 'fast', 'normal', 'none'];
const PRI_LABEL = { urgent: 'Urgent', priority: 'Priority', fast: 'Fast order', normal: 'Normal', none: 'No priority' };
const ITEM_STATUSES = ['queued', 'preparing', 'prepared', 'ready', 'served', 'reprepare'];

/**
 * Who may move a dish from which status to which.
 *   kitchen: cook (preparing/prepared), "Serve dish" (ready = call the waiter), RE-PREPARE
 *   service: served (picked up & delivered), RE-PREPARE (guest sent it back)
 *   admin:   everything, including correcting mistakes
 */
const KITCHEN_FWD = ['queued', 'preparing', 'prepared', 'reprepare'];
const TRANSITIONS = {
  kitchen: {
    preparing: KITCHEN_FWD, prepared: KITCHEN_FWD, ready: KITCHEN_FWD,
    reprepare: ['preparing', 'prepared', 'ready', 'served'],
  },
  service: {
    served: ['ready'],
    reprepare: ['ready', 'served'],
  },
  admin: {
    queued: ['preparing', 'prepared', 'ready', 'reprepare'],
    preparing: KITCHEN_FWD, prepared: KITCHEN_FWD, ready: KITCHEN_FWD,
    served: ['queued', 'preparing', 'prepared', 'ready', 'reprepare'],
    reprepare: ['preparing', 'prepared', 'ready', 'served'],
  },
};

// ------------------------------------------------------------------ schemas
const Loc = z.object({
  type: z.enum(['room', 'table']).default('table'),
  num: z.union([z.string(), z.number()]).transform(v => String(v).trim().toUpperCase()).pipe(z.string().regex(/^[A-Z0-9._~-]{1,12}$/, 'room/table number')).default('GUEST'),
}).default({ type: 'table', num: 'GUEST' });
const NewOrder = z.object({
  loc: Loc.optional().default({ type: 'table', num: 'GUEST' }),
  items: z.array(z.object({ id: z.string().min(1).max(80), qty: z.coerce.number().int().min(1).max(50) }).passthrough()).min(1).max(40),
  note: z.string().trim().max(300).default(''),
  priority: z.enum(PRIORITIES).optional(),
  guestName: z.string().trim().max(100).optional().default(''),
  guestPhone: z.string().trim().max(30).optional().default(''),
}).passthrough();
const ItemsPatch = z.object({ keys: z.array(z.string().min(1).max(20)).min(1).max(60), status: z.enum(ITEM_STATUSES) }).strict();
const PriorityPatch = z.object({ priority: z.enum(PRIORITIES) }).strict();
const ListQuery = z.object({
  status: z.enum(['open', 'completed', 'cancelled', 'all']).default('all'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),          // one business day (APP_TZ)
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  days: z.coerce.number().int().min(1).max(366).optional(),           // last N days incl. today
  q: z.string().trim().max(60).optional(),                            // code, room/table no. or dish name
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

// ------------------------------------------------------------------ read helpers
const ORDER_SELECT = `
  SELECT o.*, COALESCE(json_agg(json_build_object(
      'k', i.id, 'id', i.menu_item_id, 'name', i.name, 'price', i.price, 'qty', i.qty, 'veg', i.veg, 'egg', i.egg,
      'status', i.status, 'redo', i.redo, 't', (extract(epoch from i.status_at)*1000)::bigint
    ) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
  FROM orders o LEFT JOIN order_items i ON i.order_id = o.id`;
const ms = d => (d ? new Date(d).getTime() : null);

function toApi(r, { includeToken = false } = {}) {
  const o = {
    id: r.id, code: r.code, loc: { type: r.loc_type, num: r.loc_num }, source: r.source, priority: r.priority,
    status: r.status, note: r.note,
    guestName: r.guest_name || '',
    guestPhone: r.guest_phone || '',
    createdAt: ms(r.created_at), updatedAt: ms(r.updated_at),
    completedAt: ms(r.completed_at), cancelledAt: ms(r.cancelled_at),
    items: (r.items || []).map(i => ({ ...i, price: Number(i.price), t: Number(i.t) })),
    bill: { subtotal: Number(r.subtotal), taxes: r.taxes, charges: r.charges, total: Number(r.total) },
  };
  if (includeToken) o.guestToken = r.guest_token;
  return o;
}
async function load(id, client = { query }) {
  const { rows } = await client.query(`${ORDER_SELECT} WHERE o.id=$1 GROUP BY o.id`, [id]);
  return rows[0] ? toApi(rows[0]) : null;
}
async function get(id) {
  const o = await load(id);
  if (!o) throw notFound('Order');
  return o;
}

const lineText = items => items.map(i => `${i.qty}× ${i.name}`).join(', ');
async function event(c, orderId, action, { items, from, to, actor } = {}) {
  await c.query(`INSERT INTO order_events(order_id,item_ids,action,from_value,to_value,actor_id,actor_role) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [orderId, items || null, action, from || null, to || null, actor && actor.id ? actor.id : null, actor ? actor.role : 'guest']);
}

// ------------------------------------------------------------------ create
/**
 * @param body  {loc:{type,num}, items:[{id,qty}], note?, priority?}
 * @param staff null for guests (QR menu), or {id, role} for a waiter/admin order
 */
async function create(body, staff) {
  const d = parse(NewOrder, body);
  if (staff && staff.role === 'kitchen') throw forbidden('Kitchen logins cannot place orders');
  const source = staff ? 'waiter' : 'guest';
  const priority = staff ? (d.priority || 'normal') : 'normal';   // guests cannot jump the queue

  // merge duplicate dishes, keep first-seen order
  const merged = new Map();
  for (const l of d.items) merged.set(l.id, Math.min(50, (merged.get(l.id) || 0) + l.qty));

  const result = await tx(async c => {
    if (d.loc && d.loc.num !== 'GUEST') {
      const access = await settings.getKey('access', c);
      const allowed = settings.parseRange(d.loc.type === 'room' ? access.rooms : access.tables);
      if (allowed.length && !allowed.includes(d.loc.num)) {
        throw bad(`${d.loc.type === 'room' ? 'Room' : 'Table'} ${d.loc.num} is not on this property’s list`);
      }
    }
    const { rows: dishes } = await c.query('SELECT id,name,price,veg,egg,available FROM menu_items WHERE id = ANY($1)', [[...merged.keys()]]);
    const byId = new Map(dishes.map(x => [x.id, x]));
    const missing = [...merged.keys()].filter(id => !byId.has(id));
    if (missing.length) throw conflict('Some dishes are no longer on the menu', { missing });
    const off = [...merged.keys()].filter(id => !byId.get(id).available);
    if (off.length) throw conflict(`Not available right now: ${off.map(id => byId.get(id).name).join(', ')}`, { unavailable: off });

    const lines = [...merged.entries()].map(([id, qty]) => ({ ...byId.get(id), qty }));
    const billing = await settings.getKey('billing', c);
    const bill = computeBill(lines, billing);

    // short human code, unique among the last 2 days so the pass never sees two #K7PQ
    let code;
    for (let i = 0; i < 12; i++) {
      code = ids.orderCode();
      const dup = await c.query("SELECT 1 FROM orders WHERE code=$1 AND created_at > now() - interval '2 days'", [code]);
      if (!dup.rowCount) break;
    }
    const id = ids.orderId();
    const guestToken = staff ? null : ids.guestToken();
    await c.query(
      `INSERT INTO orders (id,code,loc_type,loc_num,source,priority,note,guest_name,guest_phone,subtotal,taxes,charges,total,guest_token,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [id, code, d.loc.type, d.loc.num, source, priority, d.note, d.guestName || '', d.guestPhone || '', bill.subtotal, JSON.stringify(bill.taxes),
       JSON.stringify(bill.charges), bill.total, guestToken, staff ? staff.id : null]);
    let pos = 0;
    for (const l of lines) {
      await c.query(`INSERT INTO order_items (id,order_id,menu_item_id,name,price,qty,veg,egg,position) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ids.itemKey(), id, l.id, l.name, l.price, l.qty, l.veg, l.egg, pos++]);
    }
    await event(c, id, 'created', { to: priority, actor: staff });
    const n = lines.length;
    const guestInfo = d.guestName ? ` [${d.guestName}${d.guestPhone ? ' / ' + d.guestPhone : ''}]` : '';
    const alert = await alerts.add(c, {
      kind: 'new', orderId: id, code, loc: d.loc,
      text: (staff ? `New ${PRI_LABEL[priority].toLowerCase()} order from the floor` : `New order ${n} dish${n > 1 ? 'es' : ''}`) + guestInfo,
    });
    const order = await load(id, c);
    return { order, alert, guestToken };
  });
  bus.publish('order.created', result.order);
  bus.publish('alert.created', result.alert);
  return { ...result.order, guestToken: result.guestToken || undefined };
}

// ------------------------------------------------------------------ mutations
async function lockOrder(c, id) {
  const { rows } = await c.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [id]);
  if (!rows[0]) throw notFound('Order');
  return rows[0];
}
async function finish(c, id, newAlerts) {
  const order = await load(id, c);
  return { order, alerts: newAlerts.filter(Boolean) };
}
function publishAll({ order, alerts: al }) {
  bus.publish('order.updated', order);
  for (const a of al) bus.publish('alert.created', a);
  return order;
}

/** Set one status on several dishes of an order. Dishes already in that status or not allowed are skipped. */
async function setItems(id, body, staff) {
  const { keys, status } = parse(ItemsPatch, body);
  const rules = (TRANSITIONS[staff.role] || {})[status];
  if (!rules) throw forbidden(`${cap(staff.role)} logins cannot mark dishes “${status}”`);
  const out = await tx(async c => {
    const o = await lockOrder(c, id);
    if (o.status === 'cancelled') throw conflict('This order was cancelled');
    const { rows: items } = await c.query('SELECT * FROM order_items WHERE order_id=$1 AND id = ANY($2) ORDER BY position FOR UPDATE', [id, keys]);
    if (items.length !== new Set(keys).size) throw notFound('Dish on this order');
    const change = items.filter(i => i.status !== status && rules.includes(i.status));
    if (!change.length) {
      if (items.every(i => i.status === status)) return finish(c, id, []);           // idempotent repeat
      throw conflict(`Cannot mark ${items.map(i => i.name).join(', ')} “${status}” from “${items[0].status}”`);
    }
    const changeIds = change.map(i => i.id);
    await c.query(`UPDATE order_items SET status=$1, status_at=now(), redo = redo + $2 WHERE order_id=$3 AND id = ANY($4)`,
      [status, status === 'reprepare' ? 1 : 0, id, changeIds]);
    await event(c, id, 'item_status', { items: changeIds, from: [...new Set(change.map(i => i.status))].join(','), to: status, actor: staff });

    // order status follows its dishes
    const { rows: all } = await c.query('SELECT status FROM order_items WHERE order_id=$1', [id]);
    const allServed = all.length && all.every(i => i.status === 'served');
    if (allServed && o.status === 'open') {
      await c.query("UPDATE orders SET status='completed', completed_at=now(), updated_at=now() WHERE id=$1", [id]);
      await event(c, id, 'complete', { actor: staff });
    } else if (!allServed && o.status === 'completed') {
      await c.query("UPDATE orders SET status='open', completed_at=NULL, updated_at=now() WHERE id=$1", [id]);
      await event(c, id, 'reopen', { actor: staff });
    } else {
      await c.query('UPDATE orders SET updated_at=now() WHERE id=$1', [id]);
    }
    const loc = { type: o.loc_type, num: o.loc_num };
    let a = null;
    if (status === 'ready') a = await alerts.add(c, { kind: 'serve', orderId: id, code: o.code, loc, text: 'Serve now: ' + lineText(change) });
    if (status === 'reprepare') a = await alerts.add(c, { kind: 'reprepare', orderId: id, code: o.code, loc, text: 'RE-PREPARE: ' + lineText(change) });
    const res = await finish(c, id, [a]);
    res.skipped = items.filter(i => !changeIds.includes(i.id) && i.status !== status).map(i => i.id);
    return res;
  });
  publishAll(out);
  return out.skipped && out.skipped.length ? { ...out.order, skipped: out.skipped } : out.order;
}

async function setPriority(id, body, staff) {
  const { priority } = parse(PriorityPatch, body);
  const out = await tx(async c => {
    const o = await lockOrder(c, id);
    if (o.status !== 'open') throw conflict('Only open orders can be re-prioritised');
    if (staff.role === 'kitchen') throw forbidden('Ask the manager or a waiter to change priority');
    if (staff.role === 'service') {
      const { rows } = await c.query("SELECT count(*)::int AS n FROM order_items WHERE order_id=$1 AND status<>'queued'", [id]);
      if (rows[0].n) throw forbidden('The kitchen has started this order; ask the manager to change priority');
    }
    if (o.priority === priority) return finish(c, id, []);
    await c.query('UPDATE orders SET priority=$1, updated_at=now() WHERE id=$2', [priority, id]);
    await event(c, id, 'priority', { from: o.priority, to: priority, actor: staff });
    const a = await alerts.add(c, { kind: 'priority', orderId: id, code: o.code, loc: { type: o.loc_type, num: o.loc_num }, text: 'Priority set to ' + PRI_LABEL[priority] });
    return finish(c, id, [a]);
  });
  return publishAll(out);
}

async function cancel(id, staff, body = {}) {
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
  const out = await tx(async c => {
    const o = await lockOrder(c, id);
    if (o.status === 'cancelled') return finish(c, id, []);
    if (o.status === 'completed') throw conflict('Completed orders cannot be cancelled');
    await c.query("UPDATE orders SET status='cancelled', cancelled_at=now(), updated_at=now() WHERE id=$1", [id]);
    await event(c, id, 'cancel', { from: o.status, to: reason || null, actor: staff });
    const a = await alerts.add(c, { kind: 'cancel', orderId: id, code: o.code, loc: { type: o.loc_type, num: o.loc_num }, text: 'Order cancelled' + (reason ? ': ' + reason : '') });
    return finish(c, id, [a]);
  });
  return publishAll(out);
}

/** Admin: mark every dish served and close the order (e.g. paid & left). */
async function complete(id, staff) {
  const out = await tx(async c => {
    const o = await lockOrder(c, id);
    if (o.status === 'cancelled') throw conflict('This order was cancelled');
    if (o.status === 'completed') return finish(c, id, []);
    await c.query("UPDATE order_items SET status='served', status_at=now() WHERE order_id=$1 AND status<>'served'", [id]);
    await c.query("UPDATE orders SET status='completed', completed_at=now(), updated_at=now() WHERE id=$1", [id]);
    await event(c, id, 'complete', { actor: staff });
    return finish(c, id, []);
  });
  return publishAll(out);
}

// ------------------------------------------------------------------ queries
async function list(params) {
  const p = parse(ListQuery, params || {});
  const where = []; const vals = [];
  const v = x => { vals.push(x); return '$' + vals.length; };
  let tz = null;
  const tzRef = () => (tz = tz || v(config.timezone));
  const dayOf = () => `(o.created_at AT TIME ZONE ${tzRef()})::date`;
  if (p.status !== 'all') where.push(`o.status = ${v(p.status)}`);
  if (p.date) where.push(`${dayOf()} = ${v(p.date)}::date`);
  if (p.from) where.push(`${dayOf()} >= ${v(p.from)}::date`);
  if (p.to) where.push(`${dayOf()} <= ${v(p.to)}::date`);
  if (p.days) where.push(`${dayOf()} > (now() AT TIME ZONE ${tzRef()})::date - ${v(p.days)}::int`);
  if (p.q) {
    const like = v('%' + p.q.toUpperCase().replace(/[%_]/g, '') + '%');
    where.push(`(o.code ILIKE ${like} OR o.loc_num ILIKE ${like} OR COALESCE(o.guest_name, '') ILIKE ${like} OR COALESCE(o.guest_phone, '') ILIKE ${like} OR EXISTS (SELECT 1 FROM order_items x WHERE x.order_id=o.id AND upper(x.name) LIKE ${like}))`);
  }
  // open orders are always included in a "recent" feed so the kitchen never loses an old ticket
  const whereSql = where.length ? `WHERE (${where.join(' AND ')})${p.days && p.status === 'all' && !p.q ? " OR o.status='open'" : ''}` : '';
  const { rows } = await query(`${ORDER_SELECT} ${whereSql} GROUP BY o.id ORDER BY o.created_at DESC LIMIT ${v(p.limit)}`, vals);
  return rows.map(r => toApi(r));
}

/** Guest device follows its own orders with the tokens it received when ordering. */
async function track(tokens) {
  const t = (Array.isArray(tokens) ? tokens : String(tokens || '').split(',')).map(s => String(s).trim()).filter(s => /^[A-Za-z0-9_-]{16,64}$/.test(s)).slice(0, 20);
  if (!t.length) return [];
  const { rows } = await query(`${ORDER_SELECT} WHERE o.guest_token = ANY($1) AND o.created_at > now() - interval '2 days' GROUP BY o.id ORDER BY o.created_at DESC`, [t]);
  return rows.map(r => toApi(r));
}
async function guestTokenOf(id) {
  const { rows } = await query('SELECT guest_token FROM orders WHERE id=$1', [id]);
  return rows[0] ? rows[0].guest_token : null;
}
async function eventsOf(id) {
  const { rows } = await query(`SELECT e.action, e.item_ids AS items, e.from_value AS "from", e.to_value AS "to", e.actor_role AS role,
      s.name AS by, (extract(epoch from e.at)*1000)::bigint AS at
    FROM order_events e LEFT JOIN staff_users s ON s.id=e.actor_id WHERE e.order_id=$1 ORDER BY e.at, e.id`, [id]);
  return rows;
}

async function clearAll() {
  await query('DELETE FROM order_events');
  await query('DELETE FROM order_items');
  await query('DELETE FROM alerts');
  await query('DELETE FROM orders');
  bus.publish('orders.cleared', {});
  return { ok: true, cleared: true };
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
module.exports = { create, get, list, track, setItems, setPriority, cancel, complete, clearAll, eventsOf, guestTokenOf, TRANSITIONS, PRIORITIES };

