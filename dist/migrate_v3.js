const db = require('./db');

async function migrateV3() {
  console.log('[Migration V3] Starting Pax Slabs, Raw Material & Extra Services Images Migration...');

  // 1. Create custom_cooking_slabs table
  await db.query(`
    CREATE TABLE IF NOT EXISTS custom_cooking_slabs (
      id SERIAL PRIMARY KEY,
      min_pax INT NOT NULL,
      max_pax INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      label VARCHAR(100) NOT NULL,
      display_order INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT,
      updated_at BIGINT DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_slabs_active ON custom_cooking_slabs(is_active);
    CREATE INDEX IF NOT EXISTS idx_slabs_order ON custom_cooking_slabs(display_order);
  `);
  console.log('[Migration V3] Table `custom_cooking_slabs` verified.');

  // Seed default slabs if empty
  const countRes = await db.query('SELECT COUNT(*) FROM custom_cooking_slabs');
  if (parseInt(countRes.rows[0].count, 10) === 0) {
    console.log('[Migration V3] Seeding initial Pax Slabs...');
    const defaultSlabs = [
      { min: 1, max: 5, price: 2000, label: '1 - 5 Persons (Small Group)', order: 10 },
      { min: 6, max: 10, price: 3500, label: '6 - 10 Persons (Medium Group)', order: 20 },
      { min: 11, max: 15, price: 5000, label: '11 - 15 Persons (Large Family)', order: 30 },
      { min: 16, max: 20, price: 6500, label: '16 - 20 Persons (Villa Gathering)', order: 40 },
      { min: 21, max: 30, price: 8000, label: '21+ Persons (Grand Celebration)', order: 50 }
    ];

    for (const s of defaultSlabs) {
      await db.query(
        `INSERT INTO custom_cooking_slabs (min_pax, max_pax, price, label, display_order, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [s.min, s.max, s.price, s.label, s.order]
      );
    }
    console.log('[Migration V3] Seeded 5 default cooking pax slabs.');
  }

  // 2. Add columns to orders table
  await db.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS pax_count INT DEFAULT 1;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_material_source VARCHAR(50) DEFAULT 'self';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_material_notes TEXT DEFAULT '';
  `);
  console.log('[Migration V3] Orders table updated with pax_count & raw_material_source.');

  // 3. Update extra_services table images
  await db.query(`
    UPDATE extra_services SET image_url = 'photos/bonfire.webp' WHERE id = 'srv_bonfire';
    UPDATE extra_services SET image_url = 'photos/lawn_bbq.webp' WHERE id = 'srv_bbq';
    UPDATE extra_services SET image_url = 'photos/spa_massage.webp' WHERE id = 'srv_spa';
    UPDATE extra_services SET image_url = 'photos/acoustic_singer.webp' WHERE id = 'srv_singer';
  `);
  console.log('[Migration V3] Updated extra_services images with real matching photos.');

  console.log('[Migration V3] Migration completed successfully!');
}

if (require.main === module) {
  migrateV3()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Migration V3 Error]', err);
      process.exit(1);
    });
}

module.exports = migrateV3;
