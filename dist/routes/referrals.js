'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all referral sources
router.get('/', async (req, res) => {
  try {
    const { all } = req.query;
    let query = 'SELECT * FROM referral_sources';
    if (!all) {
      query += ' WHERE is_active = true';
    }
    query += ' ORDER BY display_order ASC, name ASC';

    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching referral sources:', err);
    res.status(500).json({ error: 'Failed to fetch referral sources' });
  }
});

// POST create a referral source
router.post('/', async (req, res) => {
  try {
    const { name, source_type, phone, display_order } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Referral source name is required' });
    }

    const trimmedName = name.trim();
    const type = source_type || 'staff';
    const order = display_order !== undefined ? parseInt(display_order, 10) : 50;

    const result = await db.query(
      `INSERT INTO referral_sources (name, source_type, phone, is_active, display_order)
       VALUES ($1, $2, $3, true, $4)
       RETURNING *`,
      [trimmedName, type, phone || '', order]
    );

    const created = result.rows[0];
    if (req.io) req.io.emit('referrals:updated', { action: 'created', item: created });
    res.status(201).json(created);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A referral source with this name already exists' });
    }
    console.error('Error creating referral source:', err);
    res.status(500).json({ error: 'Failed to create referral source' });
  }
});

// PUT update referral source
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, source_type, phone, is_active, display_order } = req.body;

    const result = await db.query(
      `UPDATE referral_sources SET
         name = COALESCE($1, name),
         source_type = COALESCE($2, source_type),
         phone = COALESCE($3, phone),
         is_active = COALESCE($4, is_active),
         display_order = COALESCE($5, display_order)
       WHERE id = $6
       RETURNING *`,
      [name, source_type, phone, is_active, display_order, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Referral source not found' });
    }

    const updated = result.rows[0];
    if (req.io) req.io.emit('referrals:updated', { action: 'updated', item: updated });
    res.json(updated);
  } catch (err) {
    console.error('Error updating referral source:', err);
    res.status(500).json({ error: 'Failed to update referral source' });
  }
});

// DELETE referral source
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM referral_sources WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Referral source not found' });
    }

    if (req.io) req.io.emit('referrals:updated', { action: 'deleted', id });
    res.json({ message: 'Referral source deleted successfully', item: result.rows[0] });
  } catch (err) {
    console.error('Error deleting referral source:', err);
    res.status(500).json({ error: 'Failed to delete referral source' });
  }
});

module.exports = router;
