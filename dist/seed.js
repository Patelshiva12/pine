const fs = require('fs');
const path = require('path');
const db = require('./db');

async function seed() {
  console.log('[Seed] Initializing database schema first...');
  await db.initializeDatabase();

  // 1. Seed Menu Items
  const countRes = await db.query('SELECT COUNT(*) FROM menu_items');
  const existingCount = parseInt(countRes.rows[0].count, 10);

  const menuJsonPath = path.join(__dirname, '..', 'pines-exotica-menu', 'pines-exotica-menu', 'menu-data.json');
  if (fs.existsSync(menuJsonPath)) {
    const rawData = fs.readFileSync(menuJsonPath, 'utf-8');
    const dishes = JSON.parse(rawData);

    console.log(`[Seed] Found ${dishes.length} dishes in menu-data.json. Existing in DB: ${existingCount}`);

    for (const item of dishes) {
      await db.query(
        `INSERT INTO menu_items (id, name, section, sub, veg, egg, price, description, signature, available, img, hero, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           section = EXCLUDED.section,
           sub = EXCLUDED.sub,
           veg = EXCLUDED.veg,
           egg = EXCLUDED.egg,
           price = EXCLUDED.price,
           description = EXCLUDED.description,
           signature = EXCLUDED.signature,
           available = EXCLUDED.available,
           img = EXCLUDED.img,
           hero = EXCLUDED.hero,
           display_order = EXCLUDED.display_order,
           updated_at = CURRENT_TIMESTAMP`,
        [
          item.id,
          item.name,
          item.section || '',
          item.sub || '',
          item.veg !== false,
          !!item.egg,
          item.price || 0,
          item.desc || '',
          !!item.signature,
          item.available !== false,
          item.img || '',
          item.hero || '',
          item.order || 0
        ]
      );
    }
    console.log(`[Seed] Successfully seeded/updated ${dishes.length} menu items into PostgreSQL!`);
  } else {
    console.warn(`[Seed Warning] menu-data.json not found at ${menuJsonPath}`);
  }

  // 2. Seed Default Settings
  const defaultSettings = {
    taxes: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }],
    charges: [{ name: 'Service charge', rate: 5 }],
    pin: '1234',
    menuLink: '',
    rooms: '101-106',
    tables: '1-8'
  };

  await db.query(
    `INSERT INTO settings (key, data, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key) DO NOTHING`,
    ['billing', JSON.stringify(defaultSettings)]
  );
  console.log('[Seed] Default billing & staff PIN settings seeded into PostgreSQL!');
}

if (require.main === module) {
  seed()
    .then(() => {
      console.log('[Seed] Done! Exiting.');
      process.exit(0);
    })
    .catch(err => {
      console.error('[Seed Error]', err);
      process.exit(1);
    });
}

module.exports = seed;
