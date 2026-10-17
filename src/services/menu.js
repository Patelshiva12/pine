'use strict';
const { z } = require('zod');
const { query } = require('../db');
const { parse, notFound } = require('../errors');
const bus = require('../bus');
const photos = require('./photos');
const ids = require('../ids');

const COLS = 'id,name,section,sub,description,price,veg,egg,signature,available,img,hero,sort_order,updated_at';
const toApi = r => ({
  id: r.id, name: r.name, section: r.section, sub: r.sub, desc: r.description, price: r.price,
  veg: r.veg, egg: r.egg, signature: r.signature, available: r.available, img: r.img, hero: r.hero,
  order: r.sort_order, updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null,
});

// img/hero: '' (none), a path/URL, or a data: URL (uploaded and converted on save)
const imgField = z.string().max(12_000_000).refine(s => s === '' || s.startsWith('data:image/') || /^(https?:\/\/|\/|[a-z0-9._-]+\/)[^\s"'<>]*$/i.test(s), 'must be empty, a URL/path or a data:image URL');
const DishFull = z.object({
  name: z.string().trim().min(1).max(120),
  section: z.string().trim().min(1).max(80),
  sub: z.string().trim().max(80).default(''),
  desc: z.string().trim().max(1000).default(''),
  price: z.coerce.number().min(0).max(1_000_000),
  veg: z.boolean().default(true),
  egg: z.boolean().default(false),
  signature: z.boolean().default(false),
  available: z.boolean().default(true),
  img: imgField.default(''),
  hero: imgField.default(''),
  order: z.coerce.number().int().optional(),
}).strict();
const DishPatch = DishFull.partial().strict();
const IdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, 'lowercase letters, digits and dashes');

const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

async function list({ availableOnly = false } = {}) {
  const { rows } = await query(`SELECT ${COLS} FROM menu_items ${availableOnly ? 'WHERE available' : ''} ORDER BY sort_order, name`);
  return rows.map(toApi);
}
async function get(id) {
  const { rows } = await query(`SELECT ${COLS} FROM menu_items WHERE id=$1`, [id]);
  if (!rows[0]) throw notFound('Dish');
  return toApi(rows[0]);
}

async function resolvePhotos(id, d, prev) {
  for (const k of ['img', 'hero']) {
    if (d[k] === undefined) continue;
    if (d[k].startsWith('data:')) d[k] = await photos.saveDataUrl(d[k], { menuId: id, kind: k });
    if (prev && prev[k] && prev[k] !== d[k]) await photos.remove(prev[k]);
  }
  if (d.img === '' ) d.hero = '';     // no card photo => no feature photo either
}

async function nextOrder(section) {
  const { rows } = await query(`SELECT COALESCE(MAX(sort_order) FILTER (WHERE section=$1), MAX(sort_order)+100, 0) AS o FROM menu_items`, [section]);
  return (rows[0].o || 0) + 1;
}

/** Create (id optional) */
async function create(input) {
  const { id: wantedId, ...body } = input || {};
  const d = parse(DishFull, body);
  const id = wantedId ? parse(IdSchema, wantedId) : `${slug(d.section).slice(0, 14)}-${slug(d.name).slice(0, 30)}-${ids.rand(4)}`.replace(/^-+/, '');
  if (d.order == null) d.order = await nextOrder(d.section);
  await resolvePhotos(id, d, null);
  const { rows } = await query(
    `INSERT INTO menu_items (id,name,section,sub,description,price,veg,egg,signature,available,img,hero,sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${COLS}`,
    [id, d.name, d.section, d.sub, d.desc, d.price, d.veg, d.egg, d.signature, d.available, d.img, d.hero, d.order]);
  const dish = toApi(rows[0]);
  bus.publish('menu.updated', dish);
  return dish;
}

/** Full replace or create with a known id (PUT). */
async function upsert(id, body) {
  parse(IdSchema, id);
  const exists = (await query('SELECT 1 FROM menu_items WHERE id=$1', [id])).rowCount > 0;
  if (!exists) return create({ ...body, id });
  const d = parse(DishFull, body);
  return patch(id, d);
}

/** Partial update (PATCH) — e.g. {available:false} or {price: 380} */
async function patch(id, body) {
  const d = parse(DishPatch, body);
  const prev = await get(id);
  await resolvePhotos(id, d, prev);
  const map = { name: 'name', section: 'section', sub: 'sub', desc: 'description', price: 'price', veg: 'veg', egg: 'egg',
    signature: 'signature', available: 'available', img: 'img', hero: 'hero', order: 'sort_order' };
  const sets = []; const vals = [];
  for (const [k, col] of Object.entries(map)) if (d[k] !== undefined) { vals.push(d[k]); sets.push(`${col}=$${vals.length}`); }
  if (!sets.length) return prev;
  vals.push(id);
  const { rows } = await query(`UPDATE menu_items SET ${sets.join(',')}, updated_at=now() WHERE id=$${vals.length} RETURNING ${COLS}`, vals);
  const dish = toApi(rows[0]);
  bus.publish('menu.updated', dish);
  return dish;
}

async function remove(id) {
  const prev = await get(id);
  await query('DELETE FROM menu_items WHERE id=$1', [id]);
  await photos.remove(prev.img); await photos.remove(prev.hero);
  bus.publish('menu.deleted', { id });
}

/** Photo upload from multipart (buffer). kind = img | hero */
async function setPhoto(id, buf, kind = 'img') {
  const prev = await get(id);
  const url = await photos.saveBuffer(buf, { menuId: id, kind });
  const { rows } = await query(`UPDATE menu_items SET ${kind === 'hero' ? 'hero' : 'img'}=$1, updated_at=now() WHERE id=$2 RETURNING ${COLS}`, [url, id]);
  await photos.remove(prev[kind]);
  const dish = toApi(rows[0]);
  bus.publish('menu.updated', dish);
  return dish;
}
async function clearPhoto(id, kind = 'img') {
  return patch(id, kind === 'hero' ? { hero: '' } : { img: '', hero: '' });
}

module.exports = { list, get, create, upsert, patch, remove, setPhoto, clearPhoto, toApi };
