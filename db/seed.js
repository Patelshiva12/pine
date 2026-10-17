'use strict';
// Seeds the menu, default settings and three starter staff logins.
// Safe to re-run: the menu is only seeded when empty (or with --reset-menu, which replaces it).
// Usage: node db/seed.js [--reset-menu]
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool, tx } = require('../src/db');

const DEFAULT_BILLING = {
  taxes: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }],
  charges: [{ name: 'Service charge', rate: 5 }],
};
const DEFAULT_ACCESS = { menuLink: '', rooms: '101-106', tables: '1-8' };
const DEFAULT_THALI = {
  veg: {
    id: 'pahari-dham-pahari-dham-thali',
    name: 'Pahari Dham Thali',
    price: 650,
    desc: 'Traditional Himachali feast: Rajma Madra, Chana Madra, Sepu Badi, Khatta, Mahni, Chana Dal, Aloo Palak, Steamed Rice, Pahari Raita, Mittha, Salad, Papad & Pickle. Pre-order recommended.',
    img: 'photos/dham_thali.webp',
    hero: 'photos/dham_thali_big.webp',
    items: ['Rajma Madra', 'Chana Madra', 'Sepu Badi', 'Khatta', 'Mahni', 'Chana Dal', 'Aloo Palak', 'Steamed Rice', 'Pahari Raita', 'Mittha', 'Salad, Papad & Pickle']
  },
  nonveg: {
    id: 'royal-nonveg-thali',
    name: 'Royal Non-Veg Feast Thali',
    price: 790,
    desc: 'Grand mountain feast: Mutton Rogan Josh, Butter Chicken, Dal Makhani, Steamed Rice, Butter Naan, Pahari Raita, Gulab Jamun, Salad & Chutneys.',
    img: 'photos/mutton_rogan_josh.webp',
    hero: 'photos/mutton_rogan_josh.webp',
    items: ['Mutton Rogan Josh', 'Butter Chicken', 'Dal Makhani', 'Steamed Rice', 'Butter Naan', 'Pahari Raita', 'Gulab Jamun', 'Salad & Chutneys']
  }
};
const STARTER_STAFF = [
  { name: 'Manager', role: 'admin', pin: process.env.SEED_ADMIN_PIN || '1234', phone: '', designation: 'Manager' },
  { name: 'Kitchen', role: 'kitchen', pin: process.env.SEED_KITCHEN_PIN || '1111', phone: '', designation: 'Kitchen Staff' },
  { name: 'Service', role: 'service', pin: process.env.SEED_SERVICE_PIN || '2222', phone: '', designation: 'Waiter' },
];

async function seed({ resetMenu = false, log = console.log } = {}) {
  const menu = require(path.join(__dirname, '..', 'seed', 'menu-data.json'));
  await tx(async c => {
    if (resetMenu) await c.query('DELETE FROM menu_items');
    // only fill an empty menu: dishes deleted later in content management must not come back on restart
    const { rows: [{ n: existing }] } = await c.query('SELECT count(*)::int AS n FROM menu_items');
    let n = 0;
    for (const m of existing ? [] : menu) {
      const r = await c.query(
        `INSERT INTO menu_items (id,name,section,sub,description,price,veg,egg,signature,available,img,hero,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`,
        [m.id, m.name, m.section, m.sub || '', m.desc || '', m.price, !!m.veg, !!m.egg, !!m.signature,
         m.available !== false, m.img || '', m.hero || '', m.order || 0]);
      n += r.rowCount;
    }
    if (n) log(`[seed] menu: ${n} dishes added`);
    await c.query(`INSERT INTO settings(key,value) VALUES ('billing',$1),('access',$2),('thali',$3) ON CONFLICT (key) DO NOTHING`,
      [DEFAULT_BILLING, DEFAULT_ACCESS, DEFAULT_THALI]);
    const { rows } = await c.query('SELECT count(*)::int AS n FROM staff_users');
    if (rows[0].n === 0) {
      for (const s of STARTER_STAFF) {
        await c.query('INSERT INTO staff_users(name,role,pin_hash,phone,designation) VALUES ($1,$2,$3,$4,$5)', [s.name, s.role, bcrypt.hashSync(s.pin, 10), s.phone || '', s.designation || '']);
      }
      log('[seed] staff: Manager (admin) / Kitchen / Service created. CHANGE THE PINS after first login.');
    }
  });
}

module.exports = { seed, DEFAULT_BILLING, DEFAULT_ACCESS };
if (require.main === module) {
  seed({ resetMenu: process.argv.includes('--reset-menu') })
    .then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
}
