'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all states
router.get('/states', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM geo_states ORDER BY display_order ASC, state_name ASC');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching states:', err);
    res.status(500).json({ error: 'Failed to fetch states' });
  }
});

// GET cities (optionally filter by state)
router.get('/cities', async (req, res) => {
  try {
    const { state } = req.query;
    let query = 'SELECT * FROM geo_cities WHERE is_active = true';
    const params = [];

    if (state && state.trim()) {
      params.push(state.trim());
      query += ' AND LOWER(state_name) = LOWER($1)';
    }
    query += ' ORDER BY city_name ASC';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching cities:', err);
    res.status(500).json({ error: 'Failed to fetch cities' });
  }
});

// POST add custom city
router.post('/cities', async (req, res) => {
  try {
    const { state_name, city_name, default_pincode } = req.body;
    if (!state_name || !city_name) {
      return res.status(400).json({ error: 'state_name and city_name are required' });
    }

    const result = await db.query(
      `INSERT INTO geo_cities (state_name, city_name, default_pincode, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING *`,
      [state_name.trim(), city_name.trim(), (default_pincode || '').trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error adding city:', err);
    res.status(500).json({ error: 'Failed to add city' });
  }
});

// GET lookup pincode (checks local database first, then queries India Post API if needed)
router.get('/pincode/:pincode', async (req, res) => {
  try {
    const pin = String(req.params.pincode || '').trim();
    if (!/^\d{6}$/.test(pin)) {
      return res.status(400).json({ error: 'Valid 6-digit Indian Pincode is required' });
    }

    // 1. Check local geo_cities table
    const localRes = await db.query('SELECT * FROM geo_cities WHERE default_pincode = $1 LIMIT 1', [pin]);
    if (localRes.rowCount > 0) {
      const row = localRes.rows[0];
      return res.json({
        found: true,
        pincode: pin,
        city: row.city_name,
        state: row.state_name,
        country: 'India',
        source: 'local_master'
      });
    }

    // 2. Query India Post Public API
    try {
      const response = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data) && data[0]?.Status === 'Success' && data[0]?.PostOffice?.length > 0) {
          const po = data[0].PostOffice[0];
          const city = po.District || po.Name || po.Block;
          const state = po.State;

          // Save to local cache so next time it is instant
          await db.query(
            `INSERT INTO geo_cities (state_name, city_name, default_pincode)
             VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [state, city, pin]
          ).catch(() => {});

          return res.json({
            found: true,
            pincode: pin,
            city,
            state,
            country: 'India',
            district: po.District,
            source: 'india_post'
          });
        }
      }
    } catch (apiErr) {
      console.warn('[Pincode Lookup] External API query timed out or unreachable, using local fallback.');
    }

    // Fallback if not resolved
    res.json({
      found: false,
      pincode: pin,
      country: 'India',
      message: 'Pincode not found in local master. Please enter city & state manually.'
    });
  } catch (err) {
    console.error('Error looking up pincode:', err);
    res.status(500).json({ error: 'Failed to lookup pincode' });
  }
});

module.exports = router;
