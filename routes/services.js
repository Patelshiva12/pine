const express = require('express');
const router = express.Router();
const db = require('../db');

function mapService(r) {
  return {
    id: r.id,
    name: r.name,
    category: r.category || 'Experiences',
    price: parseFloat(r.price),
    priceUnit: r.price_unit || 'per session',
    description: r.description || '',
    imageUrl: r.image_url || '',
    available: r.available,
    displayOrder: r.display_order,
    createdAt: r.created_at
  };
}

// GET all extra services
router.get('/', async (req, res) => {
  try {
    const { available } = req.query;
    let query = 'SELECT * FROM extra_services';
    const params = [];

    if (available !== undefined) {
      params.push(available === 'true' || available === true);
      query += ` WHERE available = $${params.length}`;
    }

    query += ' ORDER BY display_order ASC, name ASC';

    const result = await db.query(query, params);
    res.json(result.rows.map(mapService));
  } catch (err) {
    console.error('Error fetching extra services:', err);
    res.status(500).json({ error: 'Failed to fetch extra services' });
  }
});

// POST create extra service (Admin)
router.post('/', async (req, res) => {
  try {
    const s = req.body;
    const id = s.id || 'srv_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const name = (s.name || '').trim();
    const category = (s.category || 'Entertainment').trim();
    const price = parseFloat(s.price) || 0;
    const priceUnit = (s.priceUnit || s.price_unit || 'per session').trim();
    const description = (s.description || '').trim();
    const imageUrl = (s.imageUrl || s.image_url || '').trim();
    const order = parseInt(s.displayOrder, 10) || 50;
    const available = s.available !== false;

    if (!name) return res.status(400).json({ error: 'Service name is required' });

    await db.query(
      `INSERT INTO extra_services (id, name, category, price, price_unit, description, image_url, available, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, name, category, price, priceUnit, description, imageUrl, available, order]
    );

    const created = {
      id,
      name,
      category,
      price,
      priceUnit,
      description,
      imageUrl,
      available,
      displayOrder: order
    };

    req.io.emit('services:updated', { action: 'created', service: created });
    res.status(201).json(created);
  } catch (err) {
    console.error('Error adding extra service:', err);
    res.status(500).json({ error: 'Failed to add extra service' });
  }
});

// PUT update extra service
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const s = req.body;

    const result = await db.query(
      `UPDATE extra_services SET
         name = COALESCE($1, name),
         category = COALESCE($2, category),
         price = COALESCE($3, price),
         price_unit = COALESCE($4, price_unit),
         description = COALESCE($5, description),
         image_url = COALESCE($6, image_url),
         available = COALESCE($7, available),
         display_order = COALESCE($8, display_order)
       WHERE id = $9
       RETURNING *`,
      [
        s.name,
        s.category,
        s.price !== undefined ? parseFloat(s.price) : null,
        s.priceUnit || s.price_unit,
        s.description,
        s.imageUrl || s.image_url,
        s.available,
        s.displayOrder,
        id
      ]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Service not found' });
    const updated = mapService(result.rows[0]);
    req.io.emit('services:updated', { action: 'updated', service: updated });
    res.json(updated);
  } catch (err) {
    console.error('Error updating extra service:', err);
    res.status(500).json({ error: 'Failed to update extra service' });
  }
});

// DELETE extra service
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM extra_services WHERE id = $1', [id]);
    req.io.emit('services:updated', { action: 'deleted', id });
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error deleting extra service:', err);
    res.status(500).json({ error: 'Failed to delete extra service' });
  }
});

module.exports = router;
