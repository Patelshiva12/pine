const express = require('express');
const router = express.Router();
const db = require('../db');

const DEFAULT_SETTINGS = {
  taxes: [{ name: 'CGST', rate: 2.5 }, { name: 'SGST', rate: 2.5 }],
  charges: [{ name: 'Service charge', rate: 5 }],
  pin: '1234',
  menuLink: '',
  rooms: '101-106',
  tables: '1-8'
};

// GET settings
router.get('/', async (req, res) => {
  try {
    const result = await db.query("SELECT data FROM settings WHERE key = 'billing'");
    if (result.rowCount === 0) {
      return res.json(DEFAULT_SETTINGS);
    }
    res.json(result.rows[0].data);
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT update settings (Admin)
router.put('/', async (req, res) => {
  try {
    const newData = req.body;
    await db.query(
      `INSERT INTO settings (key, data, updated_at)
       VALUES ('billing', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (key) DO UPDATE SET
         data = EXCLUDED.data,
         updated_at = CURRENT_TIMESTAMP`,
      [JSON.stringify(newData)]
    );

    req.io.emit('settings:updated', newData);
    res.json(newData);
  } catch (err) {
    console.error('Error updating settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
