const db = require('./db');

async function migrateOrderCodes() {
  console.log('[Migration V4] Re-sequencing orders with YYYYMMDD-XXX format...');
  try {
    const res = await db.query('SELECT id, created_at, code FROM orders ORDER BY created_at ASC');
    console.log(`[Migration V4] Found ${res.rowCount} total orders.`);

    // Group by IST Date (YYYYMMDD)
    const byDate = {};
    for (const ord of res.rows) {
      const ts = Number(ord.created_at);
      const ist = new Date(ts + (5.5 * 60 * 60 * 1000));
      const yyyy = ist.getUTCFullYear();
      const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(ist.getUTCDate()).padStart(2, '0');
      const dateKey = `${yyyy}${mm}${dd}`;

      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(ord);
    }

    for (const [dateKey, list] of Object.entries(byDate)) {
      console.log(`Processing date ${dateKey}: ${list.length} orders...`);
      for (let i = 0; i < list.length; i++) {
        const ord = list[i];
        const newCode = `${dateKey}-${String(i + 1).padStart(3, '0')}`;
        await db.query('UPDATE orders SET code = $1 WHERE id = $2', [newCode, ord.id]);
        console.log(`  Updated order ${ord.id}: ${ord.code} -> ${newCode}`);
      }
    }

    console.log('[Migration V4] All existing orders re-sequenced successfully!');
    process.exit(0);
  } catch (err) {
    console.error('[Migration V4] Error:', err);
    process.exit(1);
  }
}

migrateOrderCodes();
