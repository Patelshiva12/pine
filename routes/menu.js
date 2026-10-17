const express = require('express');
const router = express.Router();
const db = require('../db');

// Map DB row to frontend object
function mapDish(row) {
  return {
    id: row.id,
    name: row.name,
    section: row.section,
    sub: row.sub || '',
    veg: row.veg,
    egg: row.egg,
    price: parseFloat(row.price),
    desc: row.description || '',
    signature: row.signature,
    available: row.available,
    img: row.img || '',
    hero: row.hero || '',
    order: row.display_order || 0,
  };
}

// GET all menu items
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM menu_items ORDER BY display_order ASC, name ASC');
    res.json(result.rows.map(mapDish));
  } catch (err) {
    console.error('Error fetching menu:', err);
    res.status(500).json({ error: 'Failed to fetch menu' });
  }
});

// POST create dish (Admin)
router.post('/', async (req, res) => {
  try {
    const item = req.body;
    const id = item.id || 'dish_' + Date.now();
    await db.query(
      `INSERT INTO menu_items (id, name, section, sub, veg, egg, price, description, signature, available, img, hero, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id,
        item.name,
        item.section || '',
        item.sub || '',
        item.veg !== false,
        !!item.egg,
        item.price || 0,
        item.desc || '',
        !!item.signature,
        item.available !== false,
        item.img || '',
        item.hero || '',
        item.order || 0
      ]
    );

    const created = mapDish({ ...item, id, price: item.price || 0, display_order: item.order || 0, description: item.desc });
    req.io.emit('menu:updated', { action: 'created', item: created });
    res.status(201).json(created);
  } catch (err) {
    console.error('Error creating dish:', err);
    res.status(500).json({ error: 'Failed to create dish' });
  }
});

// PUT / UPDATE dish
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = req.body;

    await db.query(
      `UPDATE menu_items SET
         name = COALESCE($1, name),
         section = COALESCE($2, section),
         sub = COALESCE($3, sub),
         veg = COALESCE($4, veg),
         egg = COALESCE($5, egg),
         price = COALESCE($6, price),
         description = COALESCE($7, description),
         signature = COALESCE($8, signature),
         available = COALESCE($9, available),
         img = COALESCE($10, img),
         hero = COALESCE($11, hero),
         display_order = COALESCE($12, display_order),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $13`,
      [
        item.name,
        item.section,
        item.sub,
        item.veg,
        item.egg,
        item.price,
        item.desc,
        item.signature,
        item.available,
        item.img,
        item.hero,
        item.order,
        id
      ]
    );

    const result = await db.query('SELECT * FROM menu_items WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Dish not found' });
    }

    const updated = mapDish(result.rows[0]);
    req.io.emit('menu:updated', { action: 'updated', item: updated });
    res.json(updated);
  } catch (err) {
    console.error('Error updating dish:', err);
    res.status(500).json({ error: 'Failed to update dish' });
  }
});

// DELETE dish
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM menu_items WHERE id = $1', [id]);
    req.io.emit('menu:updated', { action: 'deleted', id });
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error deleting dish:', err);
    res.status(500).json({ error: 'Failed to delete dish' });
  }
});

module.exports = router;
