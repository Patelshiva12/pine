'use strict';

const db = require('./db');

async function migrateV6() {
  console.log('[Migration V6] Starting Location, Pincode, Referral Master & Pax Expansion...');

  try {
    // 1. Expand guests table with new fields
    await db.query(`
      ALTER TABLE guests 
        ADD COLUMN IF NOT EXISTS street TEXT DEFAULT '',
        ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT '',
        ADD COLUMN IF NOT EXISTS state VARCHAR(100) DEFAULT '',
        ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'India',
        ADD COLUMN IF NOT EXISTS pincode VARCHAR(20) DEFAULT '',
        ADD COLUMN IF NOT EXISTS number_of_rooms INT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS number_of_persons INT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS adults_count INT DEFAULT 1,
        ADD COLUMN IF NOT EXISTS kids_count INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS referral_source_id INT;
      
      CREATE INDEX IF NOT EXISTS idx_guests_city ON guests(city);
      CREATE INDEX IF NOT EXISTS idx_guests_state ON guests(state);
      CREATE INDEX IF NOT EXISTS idx_guests_pincode ON guests(pincode);
    `);
    console.log('[Migration V6] `guests` table expanded with street, city, state, country, pincode, rooms, persons.');

    // 2. Create referral_sources table (Master CRUD)
    await db.query(`
      CREATE TABLE IF NOT EXISTS referral_sources (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        source_type VARCHAR(50) DEFAULT 'staff', -- 'staff', 'ota', 'agent', 'direct', 'social'
        phone VARCHAR(20) DEFAULT '',
        commission_rate NUMERIC(5,2) DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        display_order INT DEFAULT 0,
        created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_ref_active ON referral_sources(is_active);
      CREATE INDEX IF NOT EXISTS idx_ref_order ON referral_sources(display_order);
    `);
    console.log('[Migration V6] `referral_sources` master table verified.');

    // Seed default referral sources if empty
    const refCount = await db.query('SELECT COUNT(*) FROM referral_sources');
    if (parseInt(refCount.rows[0].count, 10) === 0) {
      console.log('[Migration V6] Seeding default referral sources...');
      const defaultSources = [
        { name: 'Aman (Staff)', type: 'staff', phone: '9816012345', order: 10 },
        { name: 'Direct Walk-in', type: 'direct', phone: '', order: 20 },
        { name: 'MakeMyTrip', type: 'ota', phone: '', order: 30 },
        { name: 'Agoda', type: 'ota', phone: '', order: 40 },
        { name: 'Booking.com', type: 'ota', phone: '', order: 50 },
        { name: 'Resort Website / Direct Call', type: 'direct', phone: '', order: 60 },
        { name: 'Instagram / Social Media', type: 'social', phone: '', order: 70 },
        { name: 'Corporate / Travel Agent', type: 'agent', phone: '', order: 80 }
      ];

      for (const s of defaultSources) {
        await db.query(
          `INSERT INTO referral_sources (name, source_type, phone, is_active, display_order)
           VALUES ($1, $2, $3, true, $4) ON CONFLICT (name) DO NOTHING`,
          [s.name, s.type, s.phone, s.order]
        );
      }
      console.log('[Migration V6] Seeded 8 default referral sources.');
    }

    // 3. Create Geo States & Cities Tables
    await db.query(`
      CREATE TABLE IF NOT EXISTS geo_states (
        id SERIAL PRIMARY KEY,
        country_name VARCHAR(100) DEFAULT 'India',
        state_name VARCHAR(100) NOT NULL UNIQUE,
        state_code VARCHAR(10) NOT NULL,
        display_order INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS geo_cities (
        id SERIAL PRIMARY KEY,
        state_name VARCHAR(100) NOT NULL,
        city_name VARCHAR(100) NOT NULL,
        default_pincode VARCHAR(20) DEFAULT '',
        tier VARCHAR(20) DEFAULT '2',
        is_active BOOLEAN DEFAULT TRUE
      );
      CREATE INDEX IF NOT EXISTS idx_geo_state ON geo_cities(state_name);
      CREATE INDEX IF NOT EXISTS idx_geo_city ON geo_cities(city_name);
      CREATE INDEX IF NOT EXISTS idx_geo_pin ON geo_cities(default_pincode);
    `);
    console.log('[Migration V6] `geo_states` & `geo_cities` tables verified.');

    // Seed all 28 Indian States & 8 UTs if empty
    const stateCount = await db.query('SELECT COUNT(*) FROM geo_states');
    if (parseInt(stateCount.rows[0].count, 10) === 0) {
      console.log('[Migration V6] Seeding Indian States & Union Territories...');
      const indianStates = [
        { name: 'Himachal Pradesh', code: 'HP', order: 1 },
        { name: 'Delhi', code: 'DL', order: 2 },
        { name: 'Punjab', code: 'PB', order: 3 },
        { name: 'Haryana', code: 'HR', order: 4 },
        { name: 'Chandigarh', code: 'CH', order: 5 },
        { name: 'Maharashtra', code: 'MH', order: 6 },
        { name: 'Karnataka', code: 'KA', order: 7 },
        { name: 'Gujarat', code: 'GJ', order: 8 },
        { name: 'Uttar Pradesh', code: 'UP', order: 9 },
        { name: 'Rajasthan', code: 'RJ', order: 10 },
        { name: 'Uttarakhand', code: 'UK', order: 11 },
        { name: 'West Bengal', code: 'WB', order: 12 },
        { name: 'Tamil Nadu', code: 'TN', order: 13 },
        { name: 'Telangana', code: 'TS', order: 14 },
        { name: 'Kerala', code: 'KL', order: 15 },
        { name: 'Madhya Pradesh', code: 'MP', order: 16 },
        { name: 'Andhra Pradesh', code: 'AP', order: 17 },
        { name: 'Bihar', code: 'BR', order: 18 },
        { name: 'Goa', code: 'GA', order: 19 },
        { name: 'Jammu & Kashmir', code: 'JK', order: 20 },
        { name: 'Ladakh', code: 'LA', order: 21 },
        { name: 'Assam', code: 'AS', order: 22 },
        { name: 'Odisha', code: 'OD', order: 23 },
        { name: 'Jharkhand', code: 'JH', order: 24 },
        { name: 'Chhattisgarh', code: 'CG', order: 25 },
        { name: 'Sikkim', code: 'SK', order: 26 },
        { name: 'Meghalaya', code: 'ML', order: 27 },
        { name: 'Manipur', code: 'MN', order: 28 },
        { name: 'Nagaland', code: 'NL', order: 29 },
        { name: 'Mizoram', code: 'MZ', order: 30 },
        { name: 'Tripura', code: 'TR', order: 31 },
        { name: 'Arunachal Pradesh', code: 'AR', order: 32 },
        { name: 'Puducherry', code: 'PY', order: 33 },
        { name: 'Andaman and Nicobar Islands', code: 'AN', order: 34 },
        { name: 'Dadra and Nagar Haveli and Daman and Diu', code: 'DN', order: 35 },
        { name: 'Lakshadweep', code: 'LD', order: 36 }
      ];

      for (const st of indianStates) {
        await db.query(
          `INSERT INTO geo_states (country_name, state_name, state_code, display_order)
           VALUES ('India', $1, $2, $3) ON CONFLICT (state_name) DO NOTHING`,
          [st.name, st.code, st.order]
        );
      }
      console.log(`[Migration V6] Seeded ${indianStates.length} Indian States & UTs.`);
    }

    // Seed Major Indian Cities if empty
    const cityCount = await db.query('SELECT COUNT(*) FROM geo_cities');
    if (parseInt(cityCount.rows[0].count, 10) === 0) {
      console.log('[Migration V6] Seeding Major Tourist & Metro Cities...');
      const defaultCities = [
        // Himachal Pradesh
        { state: 'Himachal Pradesh', city: 'Manali', pin: '175131' },
        { state: 'Himachal Pradesh', city: 'Kullu', pin: '175101' },
        { state: 'Himachal Pradesh', city: 'Shimla', pin: '171001' },
        { state: 'Himachal Pradesh', city: 'Dharamshala', pin: '176215' },
        { state: 'Himachal Pradesh', city: 'Mandi', pin: '175001' },
        { state: 'Himachal Pradesh', city: 'Solan', pin: '173212' },
        { state: 'Himachal Pradesh', city: 'Kasol', pin: '175105' },
        // Delhi NCR
        { state: 'Delhi', city: 'New Delhi', pin: '110001' },
        { state: 'Delhi', city: 'South Delhi', pin: '110019' },
        { state: 'Delhi', city: 'West Delhi', pin: '110027' },
        { state: 'Haryana', city: 'Gurugram', pin: '122001' },
        { state: 'Haryana', city: 'Faridabad', pin: '121001' },
        { state: 'Uttar Pradesh', city: 'Noida', pin: '201301' },
        { state: 'Uttar Pradesh', city: 'Greater Noida', pin: '201308' },
        { state: 'Uttar Pradesh', city: 'Ghaziabad', pin: '201001' },
        // Punjab & Chandigarh
        { state: 'Chandigarh', city: 'Chandigarh', pin: '160017' },
        { state: 'Punjab', city: 'Ludhiana', pin: '141001' },
        { state: 'Punjab', city: 'Amritsar', pin: '143001' },
        { state: 'Punjab', city: 'Jalandhar', pin: '144001' },
        { state: 'Punjab', city: 'Mohali', pin: '160055' },
        { state: 'Punjab', city: 'Patiala', pin: '147001' },
        // Haryana
        { state: 'Haryana', city: 'Panchkula', pin: '134109' },
        { state: 'Haryana', city: 'Ambala', pin: '134003' },
        { state: 'Haryana', city: 'Karnal', pin: '132001' },
        { state: 'Haryana', city: 'Panipat', pin: '132103' },
        // Maharashtra
        { state: 'Maharashtra', city: 'Mumbai', pin: '400001' },
        { state: 'Maharashtra', city: 'Pune', pin: '411001' },
        { state: 'Maharashtra', city: 'Nagpur', pin: '440001' },
        { state: 'Maharashtra', city: 'Thane', pin: '400601' },
        // Gujarat
        { state: 'Gujarat', city: 'Ahmedabad', pin: '380001' },
        { state: 'Gujarat', city: 'Surat', pin: '395001' },
        { state: 'Gujarat', city: 'Vadodara', pin: '390001' },
        // Karnataka & South
        { state: 'Karnataka', city: 'Bengaluru', pin: '560001' },
        { state: 'Telangana', city: 'Hyderabad', pin: '500001' },
        { state: 'Tamil Nadu', city: 'Chennai', pin: '600001' },
        { state: 'West Bengal', city: 'Kolkata', pin: '700001' },
        { state: 'Rajasthan', city: 'Jaipur', pin: '302001' },
        { state: 'Uttarakhand', city: 'Dehradun', pin: '248001' }
      ];

      for (const c of defaultCities) {
        await db.query(
          `INSERT INTO geo_cities (state_name, city_name, default_pincode)
           VALUES ($1, $2, $3)`,
          [c.state, c.city, c.pin]
        );
      }
      console.log(`[Migration V6] Seeded ${defaultCities.length} Major Indian Cities.`);
    }

    // 4. Update existing Amit record with sample address, pax and referral to verify
    await db.query(`
      UPDATE guests 
      SET street = 'Pine Forest Road, Model Town',
          city = 'New Delhi',
          state = 'Delhi',
          country = 'India',
          pincode = '110001',
          number_of_rooms = 1,
          number_of_persons = 4,
          adults_count = 3,
          kids_count = 1,
          referred_by = 'Aman (Staff)'
      WHERE name ILIKE '%Amit%' AND (city IS NULL OR city = '');
    `);
    console.log('[Migration V6] Existing Amit record backfilled with sample address, pax & referral.');

    console.log('[Migration V6] Migration V6 finished successfully!');
    return true;
  } catch (err) {
    console.error('[Migration V6 Error]', err);
    throw err;
  }
}

if (require.main === module) {
  migrateV6()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateV6;
