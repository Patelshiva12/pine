'use strict';
// WebSocket push at /ws.
//   Staff:  ws://host/ws?token=<JWT>          -> every event
//   Guests: ws://host/ws                       -> menu.* and settings.* events,
//           then send {"type":"track","tokens":["<guestToken>",...]} -> order.updated for their own orders
// Server -> client messages: {"type": "<event>", "data": {...}, "at": <ms>}
// Events: hello, order.created, order.updated, alert.created, menu.updated, menu.deleted, settings.updated
const { WebSocketServer } = require('ws');
const { URL } = require('url');
const auth = require('./auth');
const bus = require('./bus');
const { query } = require('./db');

const PUBLIC_EVENTS = new Set(['menu.updated', 'menu.deleted', 'settings.updated']);

function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  async function staffStillActive(ws) {
    if (!ws.staff) return false;
    try {
      const { rows } = await query('SELECT active, role FROM staff_users WHERE id=$1', [ws.staff.id]);
      return !!(rows[0] && rows[0].active && rows[0].role === ws.staff.role);
    } catch (_) { return true; }
  }

  wss.on('connection', async (ws, req) => {
    ws.isAlive = true; ws.orderIds = new Set(); ws.staff = null;
    ws.on('pong', () => { ws.isAlive = true; });
    let token = null;
    try { token = new URL(req.url, 'http://x').searchParams.get('token'); } catch (_) { /* ignore */ }
    const p = token && auth.verify(token);
    if (p) { ws.staff = { id: p.sub, role: p.role, name: p.name }; if (!(await staffStillActive(ws))) ws.staff = null; }
    if (token && !ws.staff) { ws.close(4401, 'invalid token'); return; }
    send(ws, 'hello', { role: ws.staff ? ws.staff.role : 'guest' });

    ws.on('message', async raw => {
      let msg; try { msg = JSON.parse(String(raw)); } catch (_) { return; }
      if (msg && msg.type === 'track' && Array.isArray(msg.tokens)) {
        const t = msg.tokens.map(String).filter(s => /^[A-Za-z0-9_-]{16,64}$/.test(s)).slice(0, 20);
        if (!t.length) return;
        const { rows } = await query("SELECT id FROM orders WHERE guest_token = ANY($1) AND created_at > now() - interval '2 days'", [t]).catch(() => ({ rows: [] }));
        rows.forEach(r => ws.orderIds.add(r.id));
        send(ws, 'tracking', { orders: [...ws.orderIds] });
      } else if (msg && msg.type === 'ping') send(ws, 'pong', {});
    });
  });

  const unsub = bus.subscribe(ev => {
    for (const ws of wss.clients) {
      if (ws.readyState !== 1) continue;
      if (ws.staff) { ws.send(JSON.stringify(ev)); continue; }
      if (PUBLIC_EVENTS.has(ev.type)) ws.send(JSON.stringify(ev));
      else if (ev.type === 'order.updated' && ws.orderIds.has(ev.data.id)) ws.send(JSON.stringify(ev));
    }
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; try { ws.ping(); } catch (_) { /* ignore */ }
    }
  }, 25_000);
  wss.on('close', () => { clearInterval(beat); unsub(); });
  beat.unref();
  return wss;
}
function send(ws, type, data) { if (ws.readyState === 1) ws.send(JSON.stringify({ type, data, at: Date.now() })); }

module.exports = { attach };
