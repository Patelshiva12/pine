const db = require('./db');

async function migrate() {
  console.log('[Migration V5] Adding room_tariff, expected_check_out_date, assigned_villa to guests table...');
  try {
    await db.query(`
      ALTER TABLE guests 
      ADD COLUMN IF NOT EXISTS room_tariff numeric(10,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS expected_check_out_date bigint,
      ADD COLUMN IF NOT EXISTS assigned_villa varchar(64);
    `);
    console.log('[Migration V5] Columns added to guests table successfully.');

    // Also populate assigned_villa for existing guests if they are assigned to a room
    const guestsRes = await db.query('SELECT id, assigned_location_type, assigned_location_number FROM guests');
    for (const g of guestsRes.rows) {
      if (g.assigned_location_type === 'villa') {
        await db.query('UPDATE guests SET assigned_villa = $1 WHERE id = $2', [g.assigned_location_number, g.id]);
      } else if (g.assigned_location_type === 'room' || g.assigned_location_type === 'table') {
        const locRes = await db.query('SELECT parent_villa FROM dining_locations WHERE UPPER(number) = $1', [g.assigned_location_number.toUpperCase()]);
        if (locRes.rowCount > 0 && locRes.rows[0].parent_villa) {
          await db.query('UPDATE guests SET assigned_villa = $1 WHERE id = $2', [locRes.rows[0].parent_villa, g.id]);
        }
      }
    }
    console.log('[Migration V5] Existing guests updated with assigned_villa.');
    process.exit(0);
  } catch (err) {
    console.error('[Migration V5 Error]', err);
    process.exit(1);
  }
}

migrate();
