'use strict';
// Admin dashboard numbers for one business day (APP_TZ), plus a daily series for reports.
const { query } = require('../db');
const config = require('../config');
const { bad } = require('../errors');

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(new Date());

async function day(date) {
  const d = date || today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw bad('date must be YYYY-MM-DD');
  const DAY = `(created_at AT TIME ZONE $1)::date = $2::date`;
  const [{ rows: [k] }, { rows: top }, { rows: [open] }, { rows: byHour }] = await Promise.all([
    query(`SELECT count(*)::int AS received,
        count(*) FILTER (WHERE status='completed')::int AS completed,
        count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
        count(*) FILTER (WHERE status='open')::int AS open,
        COALESCE(sum(total) FILTER (WHERE status='completed'),0)::numeric(12,2) AS billed,
        COALESCE(sum(subtotal) FILTER (WHERE status='completed'),0)::numeric(12,2) AS food_sales,
        round(avg(extract(epoch from completed_at-created_at)/60) FILTER (WHERE status='completed'))::int AS avg_minutes,
        count(*) FILTER (WHERE source='guest')::int AS from_guests,
        count(*) FILTER (WHERE source='waiter')::int AS from_waiters,
        count(*) FILTER (WHERE loc_type='room')::int AS rooms,
        count(*) FILTER (WHERE loc_type='table')::int AS tables
      FROM orders WHERE ${DAY}`, [config.timezone, d]),
    query(`SELECT i.menu_item_id AS id, i.name, sum(i.qty)::int AS qty, sum(i.qty*i.price)::numeric(12,2) AS sales
      FROM order_items i JOIN orders o ON o.id=i.order_id
      WHERE (o.created_at AT TIME ZONE $1)::date = $2::date AND o.status<>'cancelled'
      GROUP BY 1,2 ORDER BY qty DESC, sales DESC LIMIT 10`, [config.timezone, d]),
    query(`SELECT count(*)::int AS n FROM orders WHERE status='open'`),
    query(`SELECT extract(hour from created_at AT TIME ZONE $1)::int AS hour, count(*)::int AS orders
      FROM orders WHERE ${DAY} GROUP BY 1 ORDER BY 1`, [config.timezone, d]),
  ]);
  const { rows: [redo] } = await query(`SELECT COALESCE(sum(i.redo),0)::int AS n FROM order_items i JOIN orders o ON o.id=i.order_id WHERE (o.created_at AT TIME ZONE $1)::date=$2::date`, [config.timezone, d]);
  return {
    date: d, received: k.received, completed: k.completed, cancelled: k.cancelled, inProgressToday: k.open,
    openNow: open.n, billed: Number(k.billed), foodSales: Number(k.food_sales), avgMinutes: k.avg_minutes,
    bySource: { guest: k.from_guests, waiter: k.from_waiters }, byLocation: { room: k.rooms, table: k.tables },
    reprepared: redo.n, byHour, topDishes: top.map(t => ({ ...t, sales: Number(t.sales) })),
  };
}

async function range(from, to) {
  if (![from, to].every(x => /^\d{4}-\d{2}-\d{2}$/.test(x || ''))) throw bad('from and to must be YYYY-MM-DD');
  const { rows } = await query(`SELECT to_char((created_at AT TIME ZONE $1)::date,'YYYY-MM-DD') AS date,
      count(*)::int AS received, count(*) FILTER (WHERE status='completed')::int AS completed,
      count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
      COALESCE(sum(total) FILTER (WHERE status='completed'),0)::numeric(12,2) AS billed
    FROM orders WHERE (created_at AT TIME ZONE $1)::date BETWEEN $2::date AND $3::date
    GROUP BY 1 ORDER BY 1`, [config.timezone, from, to]);
  return rows.map(r => ({ ...r, billed: Number(r.billed) }));
}
module.exports = { day, range, today };
