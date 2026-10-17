const express = require('express');
const router = express.Router();
const db = require('../db');

function mapOrder(row) {
  return {
    id: row.id,
    code: row.code,
    source: row.source,
    loc: {
      type: row.location_type,
      num: row.location_number
    },
    priority: row.priority,
    status: row.status,
    note: row.note || '',
    items: row.items || [],
    bill: row.bill || {},
    guestId: row.guest_id || null,
    guestName: row.guest_name || '',
    guestPhone: row.guest_phone || '',
    orderType: row.order_type || 'alacarte', // 'alacarte', 'raw_material', 'extra_service'
    rawMaterialCost: parseFloat(row.raw_material_cost || 0),
    cookingCharge: parseFloat(row.cooking_charge || 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at ? Number(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? Number(row.cancelled_at) : null
  };
}

// GET all orders
router.get('/', async (req, res) => {
  try {
    const { status, limit, type, num, guestId } = req.query;
    let query = 'SELECT * FROM orders';
    const params = [];
    const conditions = [];

    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    if (type) {
      params.push(type.toLowerCase());
      conditions.push(`location_type = $${params.length}`);
    }

    if (num) {
      params.push(String(num).trim().toUpperCase());
      conditions.push(`location_number = $${params.length}`);
    }

    if (guestId) {
      params.push(guestId);
      conditions.push(`guest_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC';

    if (limit) {
      params.push(parseInt(limit, 10));
      query += ` LIMIT $${params.length}`;
    }

    const result = await db.query(query, params);
    res.json(result.rows.map(mapOrder));
  } catch (err) {
    console.error('Error fetching orders:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET Day-wise & Cumulative Stay Folio Billing (ADMIN/STAFF ONLY)
router.get('/folio', async (req, res) => {
  try {
    const { type, num, guestId } = req.query;
    if (!type && !num && !guestId) {
      return res.status(400).json({ error: 'Provide type and num (e.g. ?type=villa&num=Villa 1) or ?guestId=xyz' });
    }

    let ordersQuery = 'SELECT * FROM orders WHERE status != $1';
    const params = ['cancelled'];
    const conditions = [];

    if (type && num) {
      params.push(type.toLowerCase());
      conditions.push(`location_type = $${params.length}`);
      params.push(String(num).trim().toUpperCase());
      conditions.push(`location_number = $${params.length}`);
    }

    if (guestId) {
      params.push(guestId);
      conditions.push(`guest_id = $${params.length}`);
    }

    if (conditions.length > 0) {
      ordersQuery += ' AND (' + conditions.join(' AND ') + ')';
    }

    ordersQuery += ' ORDER BY created_at ASC';

    const ordersRes = await db.query(ordersQuery, params);
    const orders = ordersRes.rows.map(mapOrder);

    // Look for guest details if assigned
    let guestInfo = null;
    if (guestId) {
      const gRes = await db.query('SELECT * FROM guests WHERE id = $1', [guestId]);
      if (gRes.rowCount > 0) guestInfo = gRes.rows[0];
    } else if (type && num) {
      const gRes = await db.query(
        'SELECT * FROM guests WHERE assigned_location_type = $1 AND assigned_location_number = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
        [type.toLowerCase(), String(num).trim().toUpperCase(), 'checked_in']
      );
      if (gRes.rowCount > 0) guestInfo = gRes.rows[0];
    }

    // Group orders by date (YYYY-MM-DD)
    const daysMap = {};
    let totalSubtotal = 0;
    let totalTaxes = 0;
    let totalCharges = 0;
    let totalGrand = 0;
    let totalFood = 0;
    let totalServices = 0;
    let totalRawAndCooking = 0;

    for (const ord of orders) {
      const d = new Date(ord.createdAt);
      // Format YYYY-MM-DD in local time
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dateLabel = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

      if (!daysMap[dateKey]) {
        daysMap[dateKey] = {
          date: dateKey,
          label: dateLabel,
          orders: [],
          daySubtotal: 0,
          dayTaxes: 0,
          dayCharges: 0,
          dayTotal: 0
        };
      }

      const bill = ord.bill || {};
      const sub = parseFloat(bill.subtotal || 0);
      const tax = parseFloat(bill.taxes || 0);
      const chg = parseFloat(bill.charges || 0);
      const tot = parseFloat(bill.total || 0);

      daysMap[dateKey].orders.push(ord);
      daysMap[dateKey].daySubtotal += sub;
      daysMap[dateKey].dayTaxes += tax;
      daysMap[dateKey].dayCharges += chg;
      daysMap[dateKey].dayTotal += tot;

      totalSubtotal += sub;
      totalTaxes += tax;
      totalCharges += chg;
      totalGrand += tot;

      // Categorize line items
      for (const item of ord.items || []) {
        const itemTotal = (parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1);
        if (item.isService || ord.orderType === 'extra_service') {
          totalServices += itemTotal;
        } else {
          totalFood += itemTotal;
        }
      }

      if (ord.orderType === 'raw_material') {
        totalRawAndCooking += (ord.rawMaterialCost + ord.cookingCharge);
      }
    }

    const dayBreakdown = Object.values(daysMap);

    res.json({
      location: {
        type: type || (guestInfo ? guestInfo.assigned_location_type : 'room'),
        number: num || (guestInfo ? guestInfo.assigned_location_number : ''),
        num: num || (guestInfo ? guestInfo.assigned_location_number : '')
      },
      guest: guestInfo ? {
        id: guestInfo.id,
        name: guestInfo.name,
        phone: guestInfo.phone,
        aadhaar_number: guestInfo.aadhaar_number,
        aadhaarNumber: guestInfo.aadhaar_number,
        check_in_date: guestInfo.check_in_date ? Number(guestInfo.check_in_date) : null,
        checkInDate: guestInfo.check_in_date ? Number(guestInfo.check_in_date) : null
      } : null,
      totalOrdersCount: orders.length,
      days: dayBreakdown,
      dayBreakdown,
      summary: {
        totalOrders: orders.length,
        totalDays: dayBreakdown.length,
        totalFood: Math.round(totalFood * 100) / 100,
        totalServices: Math.round(totalServices * 100) / 100,
        totalRawAndCooking: Math.round(totalRawAndCooking * 100) / 100,
        totalSubtotal: Math.round(totalSubtotal * 100) / 100,
        subtotal: Math.round(totalSubtotal * 100) / 100,
        totalTaxes: Math.round(totalTaxes * 100) / 100,
        taxes: Math.round(totalTaxes * 100) / 100,
        totalCharges: Math.round(totalCharges * 100) / 100,
        charges: Math.round(totalCharges * 100) / 100,
        totalGrand: Math.round(totalGrand * 100) / 100,
        grandTotal: Math.round(totalGrand * 100) / 100
      }
    });
  } catch (err) {
    console.error('Error generating stay folio:', err);
    res.status(500).json({ error: 'Failed to generate stay folio' });
  }
});

// GET single order
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(mapOrder(result.rows[0]));
  } catch (err) {
    console.error('Error fetching order:', err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// POST create new order (Guest or Staff)
router.post('/', async (req, res) => {
  try {
    const o = req.body;
    const now = Date.now();
    const id = o.id || 'o' + now.toString(36) + Math.random().toString(36).substring(2, 6);
    const code = o.code || 'ORD-' + Math.floor(1000 + Math.random() * 9000);
    const locType = (o.loc && o.loc.type) ? o.loc.type.toLowerCase() : (o.location_type || o.locationType || 'room').toLowerCase();
    const locNum = (o.loc && o.loc.num) ? String(o.loc.num).trim().toUpperCase() : String(o.location_number || o.locationNumber || '101').trim().toUpperCase();
    const source = o.source || 'guest';
    const priority = o.priority || 'normal';
    const status = o.status || 'open';
    const note = o.note || '';
    const items = o.items || [];
    const bill = o.bill || {};
    const guestId = o.guestId || o.guest_id || null;
    const guestName = (o.guestName || o.guest_name || '').trim();
    const guestPhone = (o.guestPhone || o.guest_phone || '').trim();
    const orderType = o.orderType || o.order_type || 'alacarte';
    const rawMaterialCost = parseFloat(o.rawMaterialCost || o.raw_material_cost || 0);
    const cookingCharge = parseFloat(o.cookingCharge || o.cooking_charge || 0);
    const createdAt = o.createdAt || now;
    const updatedAt = o.updatedAt || now;

    await db.query(
      `INSERT INTO orders (id, code, source, location_type, location_number, priority, status, note, items, bill, guest_id, guest_name, guest_phone, order_type, raw_material_cost, cooking_charge, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [
        id,
        code,
        source,
        locType,
        locNum,
        priority,
        status,
        note,
        JSON.stringify(items),
        JSON.stringify(bill),
        guestId,
        guestName,
        guestPhone,
        orderType,
        rawMaterialCost,
        cookingCharge,
        createdAt,
        updatedAt
      ]
    );

    const savedOrder = {
      id,
      code,
      source,
      loc: { type: locType, num: locNum },
      priority,
      status,
      note,
      items,
      bill,
      guestId,
      guestName,
      guestPhone,
      orderType,
      rawMaterialCost,
      cookingCharge,
      createdAt,
      updatedAt
    };

    // Auto-create alert for kitchen / staff
    const alertId = 'a' + now.toString(36) + Math.random().toString(36).substring(2, 6);
    const typeLabel = orderType === 'extra_service' ? 'Extra Service Request' : (orderType === 'raw_material' ? 'Custom Cooking Request' : 'New order');
    const alertText = `${typeLabel} from ${locType.toUpperCase()} ${locNum} (${items.length} items)`;
    await db.query(
      `INSERT INTO alerts (id, order_id, code, location_type, location_number, kind, text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [alertId, id, code, locType, locNum, orderType === 'extra_service' ? 'service' : 'new', alertText, now]
    );

    // Broadcast via WebSockets
    req.io.emit('orders:created', savedOrder);
    req.io.emit('alerts:created', {
      id: alertId,
      orderId: id,
      code,
      loc: { type: locType, num: locNum },
      kind: 'new',
      text: alertText,
      at: now
    });

    console.log(`[Order Placed] #${code} [${orderType}] for ${locType} ${locNum} - Total: ₹${bill.total || 0}`);
    res.status(201).json(savedOrder);
  } catch (err) {
    console.error('Error placing order:', err);
    res.status(500).json({ error: 'Failed to place order' });
  }
});

// PATCH / UPDATE order
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const patch = req.body;
    const now = Date.now();

    const currentRes = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (currentRes.rowCount === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const current = mapOrder(currentRes.rows[0]);

    // Merge updates
    const updatedLoc = patch.loc ? { ...current.loc, ...patch.loc } : current.loc;
    const updatedItems = patch.items !== undefined ? patch.items : current.items;
    const updatedStatus = patch.status !== undefined ? patch.status : current.status;
    const updatedPriority = patch.priority !== undefined ? patch.priority : current.priority;
    const updatedNote = patch.note !== undefined ? patch.note : current.note;
    const updatedBill = patch.bill !== undefined ? patch.bill : current.bill;
    const updatedGuestId = patch.guestId !== undefined ? patch.guestId : current.guestId;
    const updatedOrderType = patch.orderType !== undefined ? patch.orderType : current.orderType;
    const updatedRawCost = patch.rawMaterialCost !== undefined ? parseFloat(patch.rawMaterialCost) : current.rawMaterialCost;
    const updatedCookCharge = patch.cookingCharge !== undefined ? parseFloat(patch.cookingCharge) : current.cookingCharge;
    const completedAt = patch.completedAt !== undefined ? patch.completedAt : (updatedStatus === 'completed' && !current.completedAt ? now : current.completedAt);
    const cancelledAt = patch.cancelledAt !== undefined ? patch.cancelledAt : (updatedStatus === 'cancelled' && !current.cancelledAt ? now : current.cancelledAt);

    await db.query(
      `UPDATE orders SET
         location_type = $1,
         location_number = $2,
         items = $3,
         status = $4,
         priority = $5,
         note = $6,
         bill = $7,
         guest_id = $8,
         order_type = $9,
         raw_material_cost = $10,
         cooking_charge = $11,
         updated_at = $12,
         completed_at = $13,
         cancelled_at = $14
       WHERE id = $15`,
      [
        updatedLoc.type.toLowerCase(),
        updatedLoc.num,
        JSON.stringify(updatedItems),
        updatedStatus,
        updatedPriority,
        updatedNote,
        JSON.stringify(updatedBill),
        updatedGuestId,
        updatedOrderType,
        updatedRawCost,
        updatedCookCharge,
        now,
        completedAt,
        cancelledAt,
        id
      ]
    );

    const merged = {
      ...current,
      loc: updatedLoc,
      items: updatedItems,
      status: updatedStatus,
      priority: updatedPriority,
      note: updatedNote,
      bill: updatedBill,
      guestId: updatedGuestId,
      orderType: updatedOrderType,
      rawMaterialCost: updatedRawCost,
      cookingCharge: updatedCookCharge,
      updatedAt: now,
      completedAt,
      cancelledAt
    };

    req.io.emit('orders:updated', merged);
    res.json(merged);
  } catch (err) {
    console.error('Error updating order:', err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

module.exports = router;
