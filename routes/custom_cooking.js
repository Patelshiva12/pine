const express = require('express');
const router = express.Router();
const db = require('../db');

function mapItem(r) {
  return {
    id: r.id,
    name: r.name,
    description: r.description || '',
    cookingCharge: parseFloat(r.cooking_charge || 0),
    price: parseFloat(r.cooking_charge || 0),
    rawMaterialType: r.raw_material_type || 'General',
    veg: r.is_veg,
    signature: r.is_signature,
    available: r.available,
    displayOrder: r.display_order,
    img: r.image_url || '',
    isRawMaterial: true,
    section: "Chef's Custom Kitchen & Raw Material",
    createdAt: r.created_at
  };
}

// GET all items (supports ?available=true)
router.get('/', async (req, res) => {
  try {
    const { available } = req.query;
    let query = 'SELECT * FROM custom_cooking_items';
    const params = [];
    if (available !== undefined) {
      params.push(available === 'true' || available === true);
      query += ' WHERE available = $1';
    }
    query += ' ORDER BY display_order ASC, created_at ASC';
    const result = await db.query(query, params);
    res.json(result.rows.map(mapItem));
  } catch (err) {
    console.error('Error fetching custom cooking items:', err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// POST add new item
router.post('/', async (req, res) => {
  try {
    const { name, description, cookingCharge, rawMaterialType, veg, signature, displayOrder, img } = req.body;
    if (!name || cookingCharge === undefined) {
      return res.status(400).json({ error: 'Name and cookingCharge are required' });
    }
    const id = 'raw_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5);
    const charge = parseFloat(cookingCharge) || 0;
    const order = parseInt(displayOrder, 10) || 50;

    await db.query(
      `INSERT INTO custom_cooking_items 
       (id, name, description, cooking_charge, raw_material_type, is_veg, is_signature, available, display_order, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
      [id, name.trim(), description || '', charge, rawMaterialType || 'General', veg !== false, !!signature, order, img || '']
    );

    const created = {
      id,
      name: name.trim(),
      description: description || '',
      cookingCharge: charge,
      price: charge,
      rawMaterialType: rawMaterialType || 'General',
      veg: veg !== false,
      signature: !!signature,
      available: true,
      displayOrder: order,
      img: img || '',
      isRawMaterial: true,
      section: "Chef's Custom Kitchen & Raw Material"
    };

    if (req.io) req.io.emit('custom_cooking:updated', { action: 'created', item: created });
    res.status(201).json(created);
  } catch (err) {
    console.error('Error adding custom cooking item:', err);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

// PUT update item
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, cookingCharge, rawMaterialType, veg, signature, available, displayOrder, img } = req.body;

    const result = await db.query(
      `UPDATE custom_cooking_items SET
         name = COALESCE($1, name),
         description = COALESCE($2, description),
         cooking_charge = COALESCE($3, cooking_charge),
         raw_material_type = COALESCE($4, raw_material_type),
         is_veg = COALESCE($5, is_veg),
         is_signature = COALESCE($6, is_signature),
         available = COALESCE($7, available),
         display_order = COALESCE($8, display_order),
         image_url = COALESCE($9, image_url)
       WHERE id = $10
       RETURNING *`,
      [name, description, cookingCharge !== undefined ? parseFloat(cookingCharge) : null, rawMaterialType, veg, signature, available, displayOrder, img, id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found' });
    const updated = mapItem(result.rows[0]);
    if (req.io) req.io.emit('custom_cooking:updated', { action: 'updated', item: updated });
    res.json(updated);
  } catch (err) {
    console.error('Error updating custom cooking item:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

// DELETE item
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM custom_cooking_items WHERE id = $1', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found' });
    if (req.io) req.io.emit('custom_cooking:updated', { action: 'deleted', id });
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error deleting custom cooking item:', err);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

module.exports = router;
