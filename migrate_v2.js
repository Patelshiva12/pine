const db = require('./db');

async function migrateV2() {
  console.log('[Migration] Starting Phase 2 Database Migration...');

  // 1. Create Guests Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      aadhaar_number VARCHAR(20),
      address TEXT DEFAULT '',
      assigned_location_type VARCHAR(50) DEFAULT 'room',
      assigned_location_number VARCHAR(50) DEFAULT '',
      check_in_date BIGINT,
      check_out_date BIGINT,
      referred_by VARCHAR(255) DEFAULT '',
      status VARCHAR(50) DEFAULT 'checked_in',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS referred_by VARCHAR(255) DEFAULT '';
    CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone);
    CREATE INDEX IF NOT EXISTS idx_guests_status ON guests(status);
  `);
  console.log('[Migration] Table `guests` verified.');

  // 2. Create Dining Locations Table (Villa, Room, Table)
  await db.query(`
    CREATE TABLE IF NOT EXISTS dining_locations (
      id VARCHAR(100) PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      number VARCHAR(50) NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,
      display_order INT DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE dining_locations ADD COLUMN IF NOT EXISTS parent_villa VARCHAR(100) DEFAULT '';
    CREATE INDEX IF NOT EXISTS idx_locations_type ON dining_locations(type);
    CREATE INDEX IF NOT EXISTS idx_locations_active ON dining_locations(is_active);
    CREATE INDEX IF NOT EXISTS idx_locations_parent_villa ON dining_locations(parent_villa);
  `);
  console.log('[Migration] Table `dining_locations` verified with parent_villa.');

  // 2b. Create Custom Cooking & Raw Material Items Table
  await db.query(`
    CREATE TABLE IF NOT EXISTS custom_cooking_items (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      description TEXT DEFAULT '',
      cooking_charge NUMERIC(10, 2) NOT NULL DEFAULT 0,
      raw_material_type VARCHAR(100) DEFAULT 'General',
      is_veg BOOLEAN DEFAULT TRUE,
      is_signature BOOLEAN DEFAULT FALSE,
      available BOOLEAN DEFAULT TRUE,
      display_order INT DEFAULT 0,
      image_url VARCHAR(255) DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_custom_cooking_available ON custom_cooking_items(available);
  `);
  console.log('[Migration] Table `custom_cooking_items` verified.');

  // 3. Create Extra Services Table (Spa, Bonfire, BBQ, Music, Singer)
  await db.query(`
    CREATE TABLE IF NOT EXISTS extra_services (
      id VARCHAR(100) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100) DEFAULT 'General',
      price NUMERIC(10, 2) NOT NULL,
      price_unit VARCHAR(50) DEFAULT 'per session',
      description TEXT DEFAULT '',
      image_url VARCHAR(255) DEFAULT '',
      available BOOLEAN DEFAULT TRUE,
      display_order INT DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_extra_services_available ON extra_services(available);
  `);
  console.log('[Migration] Table `extra_services` verified.');

  // 4. Update Orders Table with new columns for raw material cooking & guest link
  await db.query(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_id VARCHAR(100);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_type VARCHAR(50) DEFAULT 'alacarte';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS raw_material_cost NUMERIC(10, 2) DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS cooking_charge NUMERIC(10, 2) DEFAULT 0;
  `);
  console.log('[Migration] Updated `orders` table with custom cooking & guest columns.');

  // 5. Seed Initial Dining Locations if empty
  const locCount = await db.query('SELECT COUNT(*) FROM dining_locations');
  if (parseInt(locCount.rows[0].count, 10) === 0) {
    console.log('[Migration] Seeding initial Villas, Rooms, and Tables with Villa hierarchy...');
    const defaultLocations = [
      // Villas (2)
      { id: 'loc_v1', type: 'villa', name: 'Whispering Pines Villa', number: 'Villa 1', parent: '', order: 10 },
      { id: 'loc_v2', type: 'villa', name: 'Deodar View Villa', number: 'Villa 2', parent: '', order: 20 },
      // Rooms for Villa 1
      { id: 'loc_r101', type: 'room', name: 'Pine View Room 101', number: '101', parent: 'Villa 1', order: 101 },
      { id: 'loc_r102', type: 'room', name: 'Forest Suite Room 102', number: '102', parent: 'Villa 1', order: 102 },
      // Rooms for Villa 2
      { id: 'loc_r201', type: 'room', name: 'Deodar Valley Room 201', number: '201', parent: 'Villa 2', order: 201 },
      { id: 'loc_r202', type: 'room', name: 'Mountain Crest Room 202', number: '202', parent: 'Villa 2', order: 202 },
      // Tables for Villa 1
      { id: 'loc_t1', type: 'table', name: 'Dining Table 1 (Villa 1 Deck)', number: '1', parent: 'Villa 1', order: 301 },
      { id: 'loc_t2', type: 'table', name: 'Dining Table 2 (Villa 1 Garden)', number: '2', parent: 'Villa 1', order: 302 },
      // Tables for Villa 2
      { id: 'loc_t3', type: 'table', name: 'Dining Table 3 (Villa 2 Terrace)', number: '3', parent: 'Villa 2', order: 303 },
      { id: 'loc_t4', type: 'table', name: 'Dining Table 4 (Villa 2 Lawn)', number: '4', parent: 'Villa 2', order: 304 }
    ];

    for (const loc of defaultLocations) {
      await db.query(
        `INSERT INTO dining_locations (id, type, name, number, parent_villa, is_active, display_order)
         VALUES ($1, $2, $3, $4, $5, true, $6) 
         ON CONFLICT (id) DO UPDATE SET parent_villa = EXCLUDED.parent_villa`,
        [loc.id, loc.type, loc.name, loc.number, loc.parent, loc.order]
      );
    }
    console.log(`[Migration] Seeded ${defaultLocations.length} locations (Villas, Rooms, Tables).`);
  } else {
    // Ensure parent_villa is populated on existing locations
    await db.query(`UPDATE dining_locations SET parent_villa = 'Villa 1' WHERE type = 'room' AND (parent_villa IS NULL OR parent_villa = '')`);
    await db.query(`UPDATE dining_locations SET parent_villa = 'Villa 1' WHERE type = 'table' AND number = '1' AND (parent_villa IS NULL OR parent_villa = '')`);
    await db.query(`UPDATE dining_locations SET parent_villa = 'Villa 2' WHERE type = 'table' AND number = '2' AND (parent_villa IS NULL OR parent_villa = '')`);
    // Ensure Villa 2 has rooms
    await db.query(`
      INSERT INTO dining_locations (id, type, name, number, parent_villa, is_active, display_order)
      VALUES 
        ('loc_r201', 'room', 'Deodar Valley Room 201', '201', 'Villa 2', true, 201),
        ('loc_r202', 'room', 'Mountain Crest Room 202', '202', 'Villa 2', true, 202),
        ('loc_t3', 'table', 'Dining Table 3 (Villa 2 Terrace)', '3', 'Villa 2', true, 303),
        ('loc_t4', 'table', 'Dining Table 4 (Villa 2 Lawn)', '4', 'Villa 2', true, 304)
      ON CONFLICT (id) DO UPDATE SET parent_villa = EXCLUDED.parent_villa
    `);
  }

  // 5b. Seed Initial Chef's Custom Kitchen & Raw Material Items if empty
  const customCount = await db.query('SELECT COUNT(*) FROM custom_cooking_items');
  if (parseInt(customCount.rows[0].count, 10) === 0) {
    console.log('[Migration] Seeding initial Chef Custom Kitchen & Raw Material items...');
    const defaultRawItems = [
      {
        id: 'raw_veg_homestyle',
        name: 'Homestyle Fresh Veg Preparation (Your Raw Material / On Actual)',
        description: 'Bring your fresh organic farm vegetables, greens, or baby food (or procured on actuals). Cooked fresh homestyle with mountain herbs, served with Steamed Basmati Rice or Tandoori Phulkas & Fresh Salad.',
        cooking_charge: 200,
        raw_material_type: 'Your Raw Material / On Actual',
        is_veg: true,
        is_signature: true,
        display_order: 10,
        image_url: 'photos/palak_paneer.webp'
      },
      {
        id: 'raw_trout_fish',
        name: 'Pahadi River Trout / Fresh Fish (Your Raw Material / On Actual)',
        description: 'Your fresh local trout or river catch (or procured from valley market on actuals) marinated in wild mountain herbs, pan-fried in golden butter or tandoori roasted with Pahadi mustard & crushed garlic.',
        cooking_charge: 300,
        raw_material_type: 'Your Raw Material / On Actual',
        is_veg: false,
        is_signature: true,
        display_order: 20,
        image_url: 'photos/dham_thali.webp'
      },
      {
        id: 'raw_mutton_chicken',
        name: 'Pahadi Mutton / Chicken Preparation (Your Raw Material / On Actual)',
        description: 'Slow-cooked in a heavy iron handi over slow embers with stone-ground valley spices, ginger, and wild mint (Your raw meat or procured on actuals).',
        cooking_charge: 350,
        raw_material_type: 'Your Raw Material / On Actual',
        is_veg: false,
        is_signature: true,
        display_order: 30,
        image_url: 'photos/mutton_curry.webp'
      },
      {
        id: 'raw_custom_procure',
        name: 'Chef-Procured Custom Dish (Your Raw Material / On Actual)',
        description: 'Craving an off-menu dish? Request our Master Chef to procure fresh local ingredients from the valley market and cook it to your taste (Resort Cooking Fee ₹250 + Ingredients on actual market cost).',
        cooking_charge: 250,
        raw_material_type: 'Your Raw Material / On Actual',
        is_veg: true,
        is_signature: false,
        display_order: 40,
        image_url: 'photos/vegetable_biryani.webp'
      }
    ];

    for (const item of defaultRawItems) {
      await db.query(
        `INSERT INTO custom_cooking_items 
         (id, name, description, cooking_charge, raw_material_type, is_veg, is_signature, available, display_order, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9) ON CONFLICT (id) DO NOTHING`,
        [item.id, item.name, item.description, item.cooking_charge, item.raw_material_type, item.is_veg, item.is_signature, item.display_order, item.image_url]
      );
    }
    console.log(`[Migration] Seeded ${defaultRawItems.length} Chef Custom Kitchen items.`);
  }

  // 6. Seed Initial Extra Services if empty
  const srvCount = await db.query('SELECT COUNT(*) FROM extra_services');
  if (parseInt(srvCount.rows[0].count, 10) === 0) {
    console.log('[Migration] Seeding initial Extra Services...');
    const defaultServices = [
      {
        id: 'srv_bonfire',
        name: 'Evening Pine Wood Bonfire',
        category: 'Entertainment',
        price: 1200,
        price_unit: 'per session (2 hrs)',
        description: 'Cozy private bonfire setup in the mountain chill, complete with natural pine wood, pine cones, and outdoor seating.',
        image_url: 'photos/dham_thali.webp',
        order: 10
      },
      {
        id: 'srv_bbq',
        name: 'Private Lawn Live BBQ & Grills',
        category: 'Dining Experience',
        price: 1500,
        price_unit: 'setup + chef charge',
        description: 'Live barbecue grill setup at your private villa lawn or terrace with skewers, marinades, and chef service.',
        image_url: 'photos/chicken_tikka.webp',
        order: 20
      },
      {
        id: 'srv_spa',
        name: 'Himalayan Forest Spa & Massage',
        category: 'Wellness',
        price: 2200,
        price_unit: 'per person (60 min)',
        description: 'Deep tissue & herbal aroma oil full-body therapy by certified wellness masseuse in the tranquility of cedar forest.',
        image_url: 'photos/filter_coffee.webp',
        order: 30
      },
      {
        id: 'srv_singer',
        name: 'Live Acoustic Singer & Guitarist',
        category: 'Entertainment',
        price: 4500,
        price_unit: 'evening session',
        description: 'Private acoustic guitar & vocal live performance at your villa deck under the starlit Himalayan sky.',
        image_url: 'photos/masala_chai.webp',
        order: 40
      }
    ];

    for (const s of defaultServices) {
      await db.query(
        `INSERT INTO extra_services (id, name, category, price, price_unit, description, image_url, available, display_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.name, s.category, s.price, s.price_unit, s.description, s.image_url, s.order]
      );
    }
    console.log(`[Migration] Seeded ${defaultServices.length} Extra Services.`);
  }

  console.log('[Migration] Phase 2 Database Migration Finished Successfully!');
}

if (require.main === module) {
  migrateV2()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Migration Error]', err);
      process.exit(1);
    });
}

module.exports = migrateV2;
