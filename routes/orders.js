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
    paxCount: row.pax_count ? parseInt(row.pax_count, 10) : null,
    rawMaterialSource: row.raw_material_source || 'guest',
    rawMaterialNotes: row.raw_material_notes || '',
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
    const { type, num, guestId, room, table } = req.query;
    if (!type && !num && !guestId) {
      return res.status(400).json({ error: 'Provide type and num (e.g. ?type=villa&num=Villa 1) or ?guestId=xyz' });
    }

    const cleanType = type ? String(type).trim().toLowerCase() : 'room';
    const cleanNum = num ? String(num).trim().toUpperCase() : '';

    let childRooms = [];
    let childTables = [];

    if (cleanType === 'villa' && cleanNum) {
      const childrenRes = await db.query(
        'SELECT type, number FROM dining_locations WHERE UPPER(parent_villa) = $1 AND is_active = true',
        [cleanNum]
      );
      childRooms = childrenRes.rows.filter(r => r.type === 'room').map(r => r.number.toUpperCase());
      childTables = childrenRes.rows.filter(r => r.type === 'table').map(r => r.number.toUpperCase());
    }

    // Step 1: Resolve Guest Details FIRST to know stay window & room tariff
    let guestInfo = null;
    if (guestId) {
      const gRes = await db.query('SELECT * FROM guests WHERE id = $1', [guestId]);
      if (gRes.rowCount > 0) guestInfo = gRes.rows[0];
    } else if (cleanType && cleanNum) {
      let gQuery = 'SELECT * FROM guests WHERE status = $1 AND (UPPER(assigned_location_number) = $2';
      const gParams = ['checked_in', cleanNum];
      if (childRooms.length > 0) {
        gParams.push(childRooms);
        gQuery += ` OR UPPER(assigned_location_number) = ANY($${gParams.length})`;
      }
      gQuery += ') ORDER BY created_at DESC LIMIT 1';
      const gRes = await db.query(gQuery, gParams);
      if (gRes.rowCount > 0) {
        guestInfo = gRes.rows[0];
      } else {
        // Check for recently checked out guest at this location
        let gQueryPast = 'SELECT * FROM guests WHERE (UPPER(assigned_location_number) = $1';
        const gParamsPast = [cleanNum];
        if (childRooms.length > 0) {
          gParamsPast.push(childRooms);
          gQueryPast += ` OR UPPER(assigned_location_number) = ANY($${gParamsPast.length})`;
        }
        gQueryPast += ') ORDER BY created_at DESC LIMIT 1';
        const gPastRes = await db.query(gQueryPast, gParamsPast);
        if (gPastRes.rowCount > 0) guestInfo = gPastRes.rows[0];
      }
    }

    // Step 2: Determine stay window boundaries
    const checkInDate = guestInfo && guestInfo.check_in_date ? Number(guestInfo.check_in_date) : null;
    const checkOutDate = guestInfo && guestInfo.check_out_date ? Number(guestInfo.check_out_date) : null;
    const expectedCheckOutDate = guestInfo && guestInfo.expected_check_out_date ? Number(guestInfo.expected_check_out_date) : null;

    const effectiveCheckIn = checkInDate || Date.now();
    const effectiveCheckOut = checkOutDate || expectedCheckOutDate || Date.now();

    const diffMs = Math.max(0, effectiveCheckOut - effectiveCheckIn);
    const nights = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    const roomTariff = parseFloat(guestInfo?.room_tariff || 0);
    const roomSubtotal = Math.round(nights * roomTariff * 100) / 100;

    // Room GST: <= ₹7,500 is 12% (6% CGST + 6% SGST); > ₹7,500 is 18% (9% CGST + 9% SGST)
    const roomGstRate = roomTariff > 7500 ? 0.18 : (roomTariff > 0 ? 0.12 : 0);
    const roomTaxTotal = Math.round(roomSubtotal * roomGstRate * 100) / 100;
    const roomCgst = Math.round((roomTaxTotal / 2) * 100) / 100;
    const roomSgst = Math.round((roomTaxTotal - roomCgst) * 100) / 100;

    // Step 3: Query Orders STRICTLY inside the Guest Stay Window
    let ordersQuery = 'SELECT * FROM orders WHERE status != $1';
    const params = ['cancelled'];
    const conditions = [];

    if (cleanType && cleanNum) {
      if (cleanType === 'villa') {
        if (room) {
          params.push('room');
          conditions.push(`location_type = $${params.length}`);
          params.push(String(room).trim().toUpperCase());
          conditions.push(`location_number = $${params.length}`);
        } else if (table) {
          params.push('table');
          conditions.push(`location_type = $${params.length}`);
          params.push(String(table).trim().toUpperCase());
          conditions.push(`location_number = $${params.length}`);
        } else {
          const locClauses = [];
          params.push(cleanNum);
          locClauses.push(`(location_type = 'villa' AND UPPER(location_number) = $${params.length})`);

          if (childRooms.length > 0) {
            params.push(childRooms);
            locClauses.push(`(location_type = 'room' AND UPPER(location_number) = ANY($${params.length}))`);
          }
          if (childTables.length > 0) {
            params.push(childTables);
            locClauses.push(`(location_type = 'table' AND UPPER(location_number) = ANY($${params.length}))`);
          }

          conditions.push(`(${locClauses.join(' OR ')})`);
        }
      } else {
        params.push(cleanType);
        conditions.push(`location_type = $${params.length}`);
        params.push(cleanNum);
        conditions.push(`location_number = $${params.length}`);
      }
    }

    if (guestId) {
      params.push(guestId);
      conditions.push(`guest_id = $${params.length}`);
    }

    // STRICT STAY DATE BOUNDARY: Never pull orders before check-in or after check-out!
    if (checkInDate) {
      params.push(checkInDate);
      conditions.push(`created_at >= $${params.length}`);
    }
    if (checkOutDate) {
      params.push(checkOutDate);
      conditions.push(`created_at <= $${params.length}`);
    }

    if (conditions.length > 0) {
      ordersQuery += ' AND (' + conditions.join(' AND ') + ')';
    }

    ordersQuery += ' ORDER BY created_at ASC';

    const ordersRes = await db.query(ordersQuery, params);
    const orders = ordersRes.rows.map(mapOrder);

    // Fallback to guest details on the orders if no guest profile exists
    if (!guestInfo && orders.length > 0) {
      const latestWithGuest = orders.slice().reverse().find(o => o.guestName || o.guestPhone);
      if (latestWithGuest) {
        guestInfo = {
          id: latestWithGuest.guestId || null,
          name: latestWithGuest.guestName || 'Resort Guest',
          phone: latestWithGuest.guestPhone || '',
          assigned_location_type: cleanType,
          assigned_location_number: cleanNum,
          assigned_villa: cleanType === 'villa' ? cleanNum : 'Villa 1',
          room_tariff: 0,
          check_in_date: orders[0].createdAt || Date.now()
        };
      }
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
    let totalCgst = 0;
    let totalSgst = 0;

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
          dayTotal: 0,
          dayFood: 0,
          dayCooking: 0,
          dayServices: 0
        };
      }

      const bill = ord.bill || {};
      const sub = parseFloat(bill.subtotal || 0) || 0;

      let tax = 0;
      let cgstOrd = 0;
      let sgstOrd = 0;
      if (Array.isArray(bill.taxes)) {
        for (const t of bill.taxes) {
          const amt = parseFloat(t.amount || 0) || 0;
          tax += amt;
          const nm = String(t.name || '').toUpperCase();
          if (nm.includes('CGST')) cgstOrd += amt;
          else if (nm.includes('SGST')) sgstOrd += amt;
        }
      } else if (bill.taxes != null && !isNaN(parseFloat(bill.taxes))) {
        tax = parseFloat(bill.taxes);
      }
      if (cgstOrd === 0 && sgstOrd === 0 && tax > 0) {
        cgstOrd = Math.round((tax / 2) * 100) / 100;
        sgstOrd = Math.round((tax - cgstOrd) * 100) / 100;
      }

      let chg = 0;
      if (Array.isArray(bill.charges)) {
        for (const c of bill.charges) {
          chg += parseFloat(c.amount || 0) || 0;
        }
      } else if (bill.charges != null && !isNaN(parseFloat(bill.charges))) {
        chg = parseFloat(bill.charges);
      }

      let tot = parseFloat(bill.total || 0);
      if (!tot || isNaN(tot)) {
        tot = sub + tax + chg;
      }

      daysMap[dateKey].orders.push(ord);
      daysMap[dateKey].daySubtotal += sub;
      daysMap[dateKey].dayTaxes += tax;
      daysMap[dateKey].dayCharges += chg;
      daysMap[dateKey].dayTotal += tot;

      totalSubtotal += sub;
      totalTaxes += tax;
      totalCharges += chg;
      totalGrand += tot;
      totalCgst += cgstOrd;
      totalSgst += sgstOrd;

      // Categorize line items
      let ordFood = 0;
      let ordServ = 0;
      let ordRaw = 0;
      for (const item of ord.items || []) {
        const itemTotal = (parseFloat(item.price) || 0) * (parseInt(item.qty, 10) || 1);
        if (item.isService || ord.orderType === 'extra_service') {
          totalServices += itemTotal;
          ordServ += itemTotal;
        } else if (item.isRawMaterial || ord.orderType === 'raw_material') {
          ordRaw += itemTotal;
        } else {
          totalFood += itemTotal;
          ordFood += itemTotal;
        }
      }

      // Add raw material procurement actuals and/or standalone cookingCharge if not in items
      const rawCost = parseFloat(ord.rawMaterialCost || 0);
      ordRaw += rawCost;
      if (ord.orderType === 'raw_material' && (ord.items || []).length === 0) {
        ordRaw += parseFloat(ord.cookingCharge || 0);
      }
      totalRawAndCooking += ordRaw;

      daysMap[dateKey].dayFood += ordFood;
      daysMap[dateKey].dayServices += ordServ;
      daysMap[dateKey].dayCooking += ordRaw;
    }

    const dayBreakdown = Object.values(daysMap);
    const halfTax = totalCgst > 0 ? totalCgst : Math.round((totalTaxes / 2) * 100) / 100;
    const halfTaxSgst = totalSgst > 0 ? totalSgst : Math.round((totalTaxes - halfTax) * 100) / 100;

    res.json({
      location: {
        type: cleanType || (guestInfo ? guestInfo.assigned_location_type : 'villa'),
        number: cleanNum || (guestInfo ? guestInfo.assigned_location_number : 'Villa 1'),
        num: cleanNum || (guestInfo ? guestInfo.assigned_location_number : 'Villa 1'),
        villa: (guestInfo ? guestInfo.assigned_villa : null) || (cleanType === 'villa' ? cleanNum : 'Villa 1'),
        room: (guestInfo && guestInfo.assigned_location_type === 'room') ? guestInfo.assigned_location_number : (room || (cleanType === 'room' ? cleanNum : null)),
        childRooms,
        childTables
      },
      guest: guestInfo ? {
        id: guestInfo.id,
        name: guestInfo.name,
        phone: guestInfo.phone,
        aadhaar_number: guestInfo.aadhaar_number,
        aadhaarNumber: guestInfo.aadhaar_number,
        referred_by: guestInfo.referred_by || '',
        assigned_villa: guestInfo.assigned_villa || (cleanType === 'villa' ? cleanNum : 'Villa 1'),
        villa: guestInfo.assigned_villa || (cleanType === 'villa' ? cleanNum : 'Villa 1'),
        room: (guestInfo.assigned_location_type === 'room') ? guestInfo.assigned_location_number : (cleanType === 'room' ? cleanNum : ''),
        check_in_date: effectiveCheckIn,
        checkInDate: effectiveCheckIn,
        check_out_date: checkOutDate,
        checkOutDate: checkOutDate,
        expected_check_out_date: expectedCheckOutDate,
        expectedCheckOutDate: expectedCheckOutDate,
        status: guestInfo.status || 'checked_in',
        nights,
        roomTariff,
        room_tariff: roomTariff,
        roomSubtotal,
        roomCgst,
        roomSgst,
        roomTaxTotal
      } : null,
      totalOrdersCount: orders.length,
      days: dayBreakdown,
      dayBreakdown,
      summary: {
        totalOrders: orders.length,
        totalDays: dayBreakdown.length,
        nights,
        roomTariff,
        roomSubtotal,
        totalRoom: roomSubtotal,
        roomCgst,
        roomSgst,
        roomTax: roomTaxTotal,
        totalFood: Math.round(totalFood * 100) / 100,
        totalServices: Math.round(totalServices * 100) / 100,
        totalRawAndCooking: Math.round(totalRawAndCooking * 100) / 100,
        foodSubtotal: Math.round(totalSubtotal * 100) / 100,
        subtotal: Math.round((roomSubtotal + totalSubtotal) * 100) / 100,
        grossSubtotal: Math.round((roomSubtotal + totalSubtotal) * 100) / 100,
        totalCharges: Math.round(totalCharges * 100) / 100,
        charges: Math.round(totalCharges * 100) / 100,
        serviceCharge: Math.round(totalCharges * 100) / 100,
        foodCgst: halfTax,
        foodSgst: halfTaxSgst,
        cgst: Math.round((halfTax + roomCgst) * 100) / 100,
        sgst: Math.round((halfTaxSgst + roomSgst) * 100) / 100,
        totalTaxes: Math.round((totalTaxes + roomTaxTotal) * 100) / 100,
        taxes: Math.round((totalTaxes + roomTaxTotal) * 100) / 100,
        totalGrand: Math.round((roomSubtotal + roomTaxTotal + totalGrand) * 100) / 100,
        grandTotal: Math.round((roomSubtotal + roomTaxTotal + totalGrand) * 100) / 100
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

async function getNextOrderCode(targetDate) {
  const d = targetDate ? new Date(targetDate) : new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(d.getTime() + (d.getTimezoneOffset() * 60000) + istOffset);
  const yyyy = istTime.getFullYear();
  const mm = String(istTime.getMonth() + 1).padStart(2, '0');
  const dd = String(istTime.getDate()).padStart(2, '0');
  const prefix = `${yyyy}${mm}${dd}`;

  const res = await db.query(
    `SELECT code FROM orders WHERE code LIKE $1 ORDER BY code DESC LIMIT 100`,
    [`${prefix}-%`]
  );

  let maxSeq = 0;
  for (const row of res.rows) {
    const parts = (row.code || '').split('-');
    if (parts.length === 2 && parts[0] === prefix) {
      const num = parseInt(parts[1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  }

  const nextSeq = String(maxSeq + 1).padStart(3, '0');
  return `${prefix}-${nextSeq}`;
}

// POST create new order (Guest or Staff)
router.post('/', async (req, res) => {
  try {
    const o = req.body;
    const now = Date.now();
    const id = o.id || 'o' + now.toString(36) + Math.random().toString(36).substring(2, 6);
    let code = o.code;
    if (!code || !/^\d{8}-\d{3,}$/.test(code)) {
      code = await getNextOrderCode(o.createdAt || now);
    } else {
      const existing = await db.query('SELECT id FROM orders WHERE code = $1', [code]);
      if (existing.rowCount > 0) {
        code = await getNextOrderCode(o.createdAt || now);
      }
    }
    const locType = (o.loc && o.loc.type) ? o.loc.type.toLowerCase() : (o.location_type || o.locationType || 'room').toLowerCase();
    const locNum = (o.loc && o.loc.num) ? String(o.loc.num).trim().toUpperCase() : String(o.location_number || o.locationNumber || '101').trim().toUpperCase();
    const source = o.source || 'guest';
    const priority = o.priority || 'normal';
    const status = o.status || 'open';
    const note = o.note || '';
    const items = o.items || [];
    const bill = o.bill || {};
    let guestId = o.guestId || o.guest_id || null;
    let guestName = (o.guestName || o.guest_name || '').trim();
    let guestPhone = (o.guestPhone || o.guest_phone || '').trim();

    if (!guestId) {
      try {
        const villaHint = (o.loc && o.loc.villa) ? String(o.loc.villa).trim().toUpperCase() : locNum;
        const gLookup = await db.query(
          `SELECT id, name, phone FROM guests 
           WHERE status = 'checked_in' AND (
             (assigned_location_type = $1 AND UPPER(assigned_location_number) = $2)
             OR (assigned_location_type = 'villa' AND UPPER(assigned_location_number) = $3)
           )
           ORDER BY created_at DESC LIMIT 1`,
          [locType, locNum, villaHint]
        );
        if (gLookup.rowCount > 0) {
          guestId = gLookup.rows[0].id;
          if (!guestName) guestName = gLookup.rows[0].name;
          if (!guestPhone) guestPhone = gLookup.rows[0].phone;
        }
      } catch (e) {
        console.warn('Guest lookup for order failed:', e.message);
      }
    }
    const orderType = o.orderType || o.order_type || 'alacarte';
    const rawMaterialCost = parseFloat(o.rawMaterialCost || o.raw_material_cost || 0);
    const cookingCharge = parseFloat(o.cookingCharge || o.cooking_charge || 0);
    const paxCount = o.paxCount ? parseInt(o.paxCount, 10) : (o.pax_count ? parseInt(o.pax_count, 10) : null);
    const rawMaterialSource = o.rawMaterialSource || o.raw_material_source || 'guest';
    const rawMaterialNotes = o.rawMaterialNotes || o.raw_material_notes || '';
    const createdAt = o.createdAt || now;
    const updatedAt = o.updatedAt || now;

    await db.query(
      `INSERT INTO orders (id, code, source, location_type, location_number, priority, status, note, items, bill, guest_id, guest_name, guest_phone, order_type, raw_material_cost, cooking_charge, pax_count, raw_material_source, raw_material_notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
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
        paxCount,
        rawMaterialSource,
        rawMaterialNotes,
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
      paxCount,
      rawMaterialSource,
      rawMaterialNotes,
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

// Dedicated endpoint to update raw material actual cost (Admin market bill entry)
router.patch('/:id/raw-material', async (req, res) => {
  try {
    const { id } = req.params;
    const { rawMaterialCost, rawMaterialNotes } = req.body;
    const currentRes = await db.query('SELECT * FROM orders WHERE id = $1', [id]);
    if (currentRes.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    const current = mapOrder(currentRes.rows[0]);
    const cost = parseFloat(rawMaterialCost || 0);
    const notes = rawMaterialNotes !== undefined ? String(rawMaterialNotes).trim() : current.rawMaterialNotes;

    // Recalculate bill: subtotal += diff in raw cost
    const currentBill = current.bill || {};
    const oldRawCost = parseFloat(current.rawMaterialCost || 0);
    const oldSubtotal = parseFloat(currentBill.subtotal || 0);
    const newSubtotal = Math.max(0, Math.round((oldSubtotal - oldRawCost + cost) * 100) / 100);
    
    // Maintain tax/service charges ratio or fixed additions
    const taxes = parseFloat(currentBill.taxes || 0);
    const serviceCharge = parseFloat(currentBill.serviceCharge || 0);
    const newTotal = Math.round((newSubtotal + taxes + serviceCharge) * 100) / 100;
    const updatedBill = { ...currentBill, subtotal: newSubtotal, total: newTotal };

    const now = Date.now();
    await db.query(
      `UPDATE orders SET raw_material_cost = $1, raw_material_notes = $2, bill = $3, updated_at = $4 WHERE id = $5`,
      [cost, notes, JSON.stringify(updatedBill), now, id]
    );

    const merged = {
      ...current,
      rawMaterialCost: cost,
      rawMaterialNotes: notes,
      bill: updatedBill,
      updatedAt: now
    };
    if (req.io) req.io.emit('orders:updated', merged);
    res.json(merged);
  } catch (err) {
    console.error('Error updating raw material cost:', err);
    res.status(500).json({ error: 'Failed to update raw material cost' });
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
    const updatedPaxCount = patch.paxCount !== undefined ? (patch.paxCount ? parseInt(patch.paxCount, 10) : null) : current.paxCount;
    const updatedRawSource = patch.rawMaterialSource !== undefined ? patch.rawMaterialSource : current.rawMaterialSource;
    const updatedRawNotes = patch.rawMaterialNotes !== undefined ? patch.rawMaterialNotes : current.rawMaterialNotes;
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
         pax_count = $12,
         raw_material_source = $13,
         raw_material_notes = $14,
         updated_at = $15,
         completed_at = $16,
         cancelled_at = $17
       WHERE id = $18`,
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
        updatedPaxCount,
        updatedRawSource,
        updatedRawNotes,
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
      paxCount: updatedPaxCount,
      rawMaterialSource: updatedRawSource,
      rawMaterialNotes: updatedRawNotes,
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
