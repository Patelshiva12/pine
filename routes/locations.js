const express = require('express');
const router = express.Router();
const db = require('../db');

function mapLoc(r) {
  return {
    id: r.id,
    type: r.type, // 'villa', 'room', 'table'
    name: r.name,
    number: r.number,
    parentVilla: r.parent_villa || '',
    isActive: r.is_active,
    displayOrder: r.display_order,
    createdAt: r.created_at
  };
}

// GET all locations (supports ?type=villa|room|table & ?active=true & ?villa=Villa 1)
router.get('/', async (req, res) => {
  try {
    const { type, active, villa } = req.query;
    let query = 'SELECT * FROM dining_locations';
    const params = [];
    const conditions = [];

    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }

    if (active !== undefined) {
      params.push(active === 'true' || active === true);
      conditions.push(`is_active = $${params.length}`);
    }

    if (villa) {
      params.push(villa);
      conditions.push(`parent_villa = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY type ASC, display_order ASC, number ASC';

    const result = await db.query(query, params);
    const list = result.rows.map(mapLoc);

    // If query includes ?grouped=true, return categorized object
    if (req.query.grouped === 'true') {
      const grouped = {
        villas: list.filter(l => l.type === 'villa'),
        rooms: list.filter(l => l.type === 'room'),
        tables: list.filter(l => l.type === 'table')
      };
      return res.json(grouped);
    }

    res.json(list);
  } catch (err) {
    console.error('Error fetching locations:', err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// POST add location (Villa / Room / Table)
router.post('/', async (req, res) => {
  try {
    const { type, name, number, displayOrder, parentVilla } = req.body;
    if (!type || !name || !number) {
      return res.status(400).json({ error: 'Type (villa/room/table), Name and Number are required' });
    }

    const id = 'loc_' + type[0] + '_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const cleanNumber = String(number).trim().toUpperCase();
    const cleanName = String(name).trim();
    const cleanParent = parentVilla ? String(parentVilla).trim() : '';
    const order = parseInt(displayOrder, 10) || 50;

    await db.query(
      `INSERT INTO dining_locations (id, type, name, number, parent_villa, is_active, display_order)
       VALUES ($1, $2, $3, $4, $5, true, $6)`,
      [id, type.toLowerCase(), cleanName, cleanNumber, cleanParent, order]
    );

    const created = {
      id,
      type: type.toLowerCase(),
      name: cleanName,
      number: cleanNumber,
      parentVilla: cleanParent,
      isActive: true,
      displayOrder: order
    };

    req.io.emit('locations:updated', { action: 'created', location: created });
    res.status(201).json(created);
  } catch (err) {
    console.error('Error adding location:', err);
    res.status(500).json({ error: 'Failed to add location' });
  }
});

// PUT update location
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, name, number, isActive, displayOrder, parentVilla } = req.body;

    const result = await db.query(
      `UPDATE dining_locations SET
         type = COALESCE($1, type),
         name = COALESCE($2, name),
         number = COALESCE($3, number),
         is_active = COALESCE($4, is_active),
         display_order = COALESCE($5, display_order),
         parent_villa = COALESCE($6, parent_villa)
       WHERE id = $7
       RETURNING *`,
      [type ? type.toLowerCase() : null, name, number, isActive, displayOrder, parentVilla, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Location not found' });
    const updated = mapLoc(result.rows[0]);
    req.io.emit('locations:updated', { action: 'updated', location: updated });
    res.json(updated);
  } catch (err) {
    console.error('Error updating location:', err);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// DELETE location
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM dining_locations WHERE id = $1', [id]);
    req.io.emit('locations:updated', { action: 'deleted', id });
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error deleting location:', err);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

module.exports = router;
