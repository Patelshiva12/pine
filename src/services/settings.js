'use strict';
const { z } = require('zod');
const { query } = require('../db');
const { parse } = require('../errors');
const bus = require('../bus');

const Rate = z.object({ name: z.string().trim().min(1).max(40), rate: z.coerce.number().min(0).max(100) });
const Billing = z.object({ taxes: z.array(Rate).max(10), charges: z.array(Rate).max(10) }).partial().strict();
const Range = z.string().trim().max(400).regex(/^[A-Za-z0-9 ,._~-]*$/, 'use numbers, commas and ranges like 101-106');
const Access = z.object({ menuLink: z.union([z.literal(''), z.string().trim().url().max(500)]), rooms: Range, tables: Range }).partial().strict();

const DEFAULTS = {
  billing: { taxes: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }], charges: [{ name: 'Service charge', rate: 5 }] },
  access: { menuLink: '', rooms: '101-106', tables: '1-8' },
  thali: {
    veg: {
      id: 'pahari-dham-pahari-dham-thali',
      name: 'Pahari Dham Thali',
      price: 650,
      desc: 'Traditional Himachali feast: Rajma Madra, Chana Madra, Sepu Badi, Khatta, Mahni, Chana Dal, Aloo Palak, Steamed Rice, Pahari Raita, Mittha, Salad, Papad & Pickle.',
      items: ['Rajma Madra', 'Chana Madra', 'Sepu Badi', 'Khatta', 'Mahni', 'Chana Dal', 'Aloo Palak', 'Steamed Rice', 'Pahari Raita', 'Mittha', 'Salad, Papad & Pickle']
    },
    nonveg: {
      id: 'royal-nonveg-thali',
      name: 'Royal Non-Veg Feast Thali',
      price: 790,
      desc: 'Grand mountain feast: Mutton Rogan Josh, Butter Chicken, Dal Makhani, Steamed Rice, Butter Naan, Pahari Raita, Gulab Jamun, Salad & Chutneys.',
      items: ['Mutton Rogan Josh', 'Butter Chicken', 'Dal Makhani', 'Steamed Rice', 'Butter Naan', 'Pahari Raita', 'Gulab Jamun', 'Salad & Chutneys']
    }
  }
};

async function getKey(key, client = { query }) {
  const { rows } = await client.query('SELECT value FROM settings WHERE key=$1', [key]);
  return { ...DEFAULTS[key], ...(rows[0] ? rows[0].value : {}) };
}
async function setKey(key, value) {
  await query(`INSERT INTO settings(key,value,updated_at) VALUES ($1,$2,now())
               ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, [key, JSON.stringify(value)]);
}
/** Public view used by every page: taxes, charges, menuLink, rooms, tables, thali */
async function getPublic() {
  const [b, a, t] = await Promise.all([getKey('billing'), getKey('access'), getKey('thali')]);
  return { taxes: b.taxes, charges: b.charges, menuLink: a.menuLink, rooms: a.rooms, tables: a.tables, thali: t };
}
/** Admin update; accepts any subset of {taxes, charges, menuLink, rooms, tables, thali}. */
async function update(body) {
  const src = body || {};
  const b = parse(Billing, { taxes: src.taxes, charges: src.charges });
  const a = parse(Access, { menuLink: src.menuLink, rooms: src.rooms, tables: src.tables });
  const unknown = Object.keys(src).filter(k => !['taxes', 'charges', 'menuLink', 'rooms', 'tables', 'thali'].includes(k));
  if (unknown.length) parse(z.object({}).strict(), Object.fromEntries(unknown.map(k => [k, src[k]])));
  if (Object.values(b).some(v => v !== undefined)) await setKey('billing', { ...(await getKey('billing')), ...strip(b) });
  if (Object.values(a).some(v => v !== undefined)) await setKey('access', { ...(await getKey('access')), ...strip(a) });
  if (src.thali !== undefined) {
    const curThali = await getKey('thali');
    const newThali = { ...curThali, ...src.thali };
    await setKey('thali', newThali);
    if (src.thali.veg) {
      const v = src.thali.veg;
      await query(`UPDATE menu_items SET name=COALESCE($1, name), price=COALESCE($2, price), description=COALESCE($3, description) WHERE id='pahari-dham-pahari-dham-thali'`,
        [v.name || null, v.price !== undefined ? +v.price : null, v.desc || null]);
    }
    if (src.thali.nonveg) {
      const nv = src.thali.nonveg;
      await query(`UPDATE menu_items SET name=COALESCE($1, name), price=COALESCE($2, price), description=COALESCE($3, description) WHERE id='royal-nonveg-thali'`,
        [nv.name || null, nv.price !== undefined ? +nv.price : null, nv.desc || null]);
    }
  }
  const out = await getPublic();
  bus.publish('settings.updated', out);
  return out;
}
const strip = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** "101-106, 201" -> ['101',...,'106','201'] (same rules as the pages) */
function parseRange(str) {
  const out = [];
  String(str || '').split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
    const m = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { let a = +m[1], b = +m[2]; if (b - a > 200) b = a + 200; for (let i = a; i <= b; i++) out.push(String(i)); }
    else out.push(p.replace(/[^A-Za-z0-9._~-]/g, ''));
  });
  return out.filter(Boolean).map(s => s.toUpperCase());
}

module.exports = { getKey, getPublic, update, parseRange, DEFAULTS };
