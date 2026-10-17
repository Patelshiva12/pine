const express = require('express');
const router = express.Router();
const db = require('../db');

function mapGuest(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    aadhaarNumber: r.aadhaar_number || '',
    address: r.address || '',
    referredBy: r.referred_by || '',
    assignedLocationType: r.assigned_location_type || 'room',
    assignedLocationNumber: r.assigned_location_number || '',
    checkInDate: r.check_in_date ? Number(r.check_in_date) : null,
    checkOutDate: r.check_out_date ? Number(r.check_out_date) : null,
    status: r.status || 'checked_in',
    createdAt: r.created_at
  };
}

// GET all guests
router.get('/', async (req, res) => {
  try {
    const { status, search } = req.query;
    let query = 'SELECT * FROM guests';
    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (search) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR aadhaar_number ILIKE $${params.length} OR referred_by ILIKE $${params.length})`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    const result = await db.query(query, params);
    res.json(result.rows.map(mapGuest));
  } catch (err) {
    console.error('Error fetching guests:', err);
    res.status(500).json({ error: 'Failed to fetch guests' });
  }
});

// GET single guest
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM guests WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Guest not found' });
    res.json(mapGuest(result.rows[0]));
  } catch (err) {
    console.error('Error fetching guest:', err);
    res.status(500).json({ error: 'Failed to fetch guest' });
  }
});

// POST add new guest
router.post('/', async (req, res) => {
  try {
    const g = req.body;
    const now = Date.now();
    const id = g.id || 'gst_' + now.toString(36) + Math.random().toString(36).substring(2, 6);
    const name = (g.name || '').trim();
    const phone = (g.phone || '').trim();
    const aadhaar = (g.aadhaarNumber || g.aadhaar_number || '').trim();
    const address = (g.address || '').trim();
    const referredBy = (g.referredBy || g.referredByVia || g.referred_by || '').trim();
    const locType = g.assignedLocationType || g.assigned_location_type || 'room';
    const locNum = String(g.assignedLocationNumber || g.assigned_location_number || '').trim().toUpperCase();
    const checkIn = g.checkInDate || now;
    const checkOut = g.checkOutDate || null;
    const status = g.status || 'checked_in';

    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and Phone number are required' });
    }

    await db.query(
      `INSERT INTO guests (id, name, phone, aadhaar_number, address, referred_by, assigned_location_type, assigned_location_number, check_in_date, check_out_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, name, phone, aadhaar, address, referredBy, locType, locNum, checkIn, checkOut, status]
    );

    const created = {
      id,
      name,
      phone,
      aadhaarNumber: aadhaar,
      address,
      referredBy,
      assignedLocationType: locType,
      assignedLocationNumber: locNum,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      status
    };

    req.io.emit('guests:updated', { action: 'created', guest: created });
    res.status(201).json(created);
  } catch (err) {
    console.error('Error adding guest:', err);
    res.status(500).json({ error: 'Failed to add guest' });
  }
});

// PUT update guest details / status
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const g = req.body;

    const result = await db.query(
      `UPDATE guests SET
         name = COALESCE($1, name),
         phone = COALESCE($2, phone),
         aadhaar_number = COALESCE($3, aadhaar_number),
         address = COALESCE($4, address),
         assigned_location_type = COALESCE($5, assigned_location_type),
         assigned_location_number = COALESCE($6, assigned_location_number),
         check_in_date = COALESCE($7, check_in_date),
         check_out_date = COALESCE($8, check_out_date),
         status = COALESCE($9, status),
         referred_by = COALESCE($10, referred_by)
       WHERE id = $11
       RETURNING *`,
      [
        g.name,
        g.phone,
        g.aadhaarNumber,
        g.address,
        g.assignedLocationType,
        g.assignedLocationNumber,
        g.checkInDate,
        g.checkOutDate,
        g.status,
        g.referredBy !== undefined ? g.referredBy : (g.referredByVia !== undefined ? g.referredByVia : null),
        id
      ]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Guest not found' });
    const updated = mapGuest(result.rows[0]);
    req.io.emit('guests:updated', { action: 'updated', guest: updated });
    res.json(updated);
  } catch (err) {
    console.error('Error updating guest:', err);
    res.status(500).json({ error: 'Failed to update guest' });
  }
});

// DELETE / Checkout guest
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM guests WHERE id = $1', [id]);
    req.io.emit('guests:updated', { action: 'deleted', id });
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error deleting guest:', err);
    res.status(500).json({ error: 'Failed to delete guest' });
  }
});

module.exports = router;
