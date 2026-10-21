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

// --- Cooking Pax Slabs APIs ---
function mapSlab(r) {
  return {
    id: r.id,
    minPax: r.min_pax,
    maxPax: r.max_pax,
    price: parseFloat(r.price || 0),
    label: r.label,
    displayOrder: r.display_order,
    isActive: r.is_active
  };
}

// GET all slabs
router.get('/slabs', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM custom_cooking_slabs WHERE is_active = true ORDER BY display_order ASC, min_pax ASC');
    res.json(result.rows.map(mapSlab));
  } catch (err) {
    console.error('Error fetching slabs:', err);
    res.status(500).json({ error: 'Failed to fetch slabs' });
  }
});

// POST new slab
router.post('/slabs', async (req, res) => {
  try {
    const { minPax, maxPax, price, label, displayOrder } = req.body;
    if (!minPax || !maxPax || price === undefined) {
      return res.status(400).json({ error: 'minPax, maxPax, and price are required' });
    }
    const result = await db.query(
      `INSERT INTO custom_cooking_slabs (min_pax, max_pax, price, label, display_order, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING *`,
      [parseInt(minPax, 10), parseInt(maxPax, 10), parseFloat(price), (label || `${minPax}-${maxPax} Persons`).trim(), parseInt(displayOrder, 10) || 50]
    );
    const created = mapSlab(result.rows[0]);
    if (req.io) req.io.emit('custom_cooking:slabs_updated', { action: 'created', slab: created });
    res.status(201).json(created);
  } catch (err) {
    console.error('Error adding slab:', err);
    res.status(500).json({ error: 'Failed to add slab' });
  }
});

// PUT update slab
router.put('/slabs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { minPax, maxPax, price, label, displayOrder, isActive } = req.body;
    const result = await db.query(
      `UPDATE custom_cooking_slabs SET
         min_pax = COALESCE($1, min_pax),
         max_pax = COALESCE($2, max_pax),
         price = COALESCE($3, price),
         label = COALESCE($4, label),
         display_order = COALESCE($5, display_order),
         is_active = COALESCE($6, is_active),
         updated_at = (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000)::BIGINT
       WHERE id = $7 RETURNING *`,
      [
        minPax !== undefined ? parseInt(minPax, 10) : null,
        maxPax !== undefined ? parseInt(maxPax, 10) : null,
        price !== undefined ? parseFloat(price) : null,
        label !== undefined ? label.trim() : null,
        displayOrder !== undefined ? parseInt(displayOrder, 10) : null,
        isActive !== undefined ? isActive : null,
        parseInt(id, 10)
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Slab not found' });
    const updated = mapSlab(result.rows[0]);
    if (req.io) req.io.emit('custom_cooking:slabs_updated', { action: 'updated', slab: updated });
    res.json(updated);
  } catch (err) {
    console.error('Error updating slab:', err);
    res.status(500).json({ error: 'Failed to update slab' });
  }
});

// DELETE slab
router.delete('/slabs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM custom_cooking_slabs WHERE id = $1', [parseInt(id, 10)]);
    if (req.io) req.io.emit('custom_cooking:slabs_updated', { action: 'deleted', id: parseInt(id, 10) });
    res.json({ success: true, id: parseInt(id, 10) });
  } catch (err) {
    console.error('Error deleting slab:', err);
    res.status(500).json({ error: 'Failed to delete slab' });
  }
});

module.exports = router;
