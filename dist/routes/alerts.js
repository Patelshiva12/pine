const express = require('express');
const router = express.Router();
const db = require('../db');

// GET recent alerts
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows.map(r => ({
      id: r.id,
      orderId: r.order_id,
      code: r.code,
      loc: { type: r.location_type, num: r.location_number },
      kind: r.kind,
      text: r.text,
      at: Number(r.created_at)
    })));
  } catch (err) {
    console.error('Error fetching alerts:', err);
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

// POST new alert
router.post('/', async (req, res) => {
  try {
    const a = req.body;
    const now = Date.now();
    const id = a.id || 'a' + now.toString(36) + Math.random().toString(36).substring(2, 6);
    const locType = a.loc ? a.loc.type : '';
    const locNum = a.loc ? a.loc.num : '';

    await db.query(
      `INSERT INTO alerts (id, order_id, code, location_type, location_number, kind, text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, a.orderId || '', a.code || '', locType, locNum, a.kind || 'info', a.text || '', now]
    );

    const alertObj = {
      id,
      orderId: a.orderId,
      code: a.code,
      loc: a.loc,
      kind: a.kind,
      text: a.text,
      at: now
    };

    req.io.emit('alerts:created', alertObj);
    res.status(201).json(alertObj);
  } catch (err) {
    console.error('Error creating alert:', err);
    res.status(500).json({ error: 'Failed to create alert' });
  }
});

module.exports = router;
