# Pines Exotica — ordering backend

One server for all four pages: the guest **QR menu**, **Kitchen**, **Room Service** (waiters) and **Admin**
(orders, history, content management, taxes, service charges, QR codes, staff logins).

* Node.js 22 · Express 4 · PostgreSQL 14+ · WebSocket (`ws`) for live updates
* The front-end is the same single page you already have (`public/index.html`). When this server
  serves it, it injects `window.PE_API` and the page switches from "demo on this device" to the shared database.

```
Guest phone ──QR──►  /#room-102 ─┐                       ┌─ PostgreSQL
Waiter phone ──────►  /service   ├─ REST /api/v1 ──► API ─┤
Kitchen tablet ────►  /kitchen   │  WebSocket /ws ◄─ push └─ uploads/ (dish photos)
Manager laptop ────►  /admin    ─┘
```

---

## 1. Run it

### With Docker (simplest)

```bash
cp .env.example .env            # set JWT_SECRET and DB_PASSWORD
docker compose up -d
open http://localhost:8080      # guest menu
```

### Without Docker

```bash
npm ci
createdb pines
export DATABASE_URL=postgres://user:pass@localhost:5432/pines JWT_SECRET=$(openssl rand -base64 48)
npm start                       # runs migrations + seed on first start, then listens on :8080
```

| Address | Page |
|---|---|
| `/` or `/#room-102` / `/#table-4` | Guest menu (QR codes add the room/table) |
| `/kitchen` | Kitchen board |
| `/service` | Room service & restaurant floor |
| `/admin` | Administration |
| `/api/v1/...` | REST API — spec in `openapi.yaml` (also served at `/api/v1/openapi.yaml`) |

### First sign-in — change these PINs immediately

| Login | Role | Starter PIN | Opens |
|---|---|---|---|
| Manager | admin | 1234 | every page |
| Kitchen | kitchen | 1111 | Kitchen |
| Service | service | 2222 | Service |

Admin → *QR codes & access* → **Staff logins**: add a login per person, set PINs, disable leavers.
(Starter PINs can also be set before the first start with `SEED_*_PIN` in `.env`.)

### Environment

See `.env.example`. Key ones: `DATABASE_URL`, `JWT_SECRET` (required in production), `APP_TZ`
(default `Asia/Kolkata`, defines "today" and history days), `UPLOAD_DIR` (must be persistent),
`AUTO_MIGRATE` (default true).

---

## 2. What the server is responsible for

| Area | Behaviour |
|---|---|
| **Prices & bills** | Recomputed on the server from the database menu and current tax/charge settings. Prices sent by a browser are ignored. Each order stores a frozen copy of dish names, prices and its bill, so later menu or tax changes never alter old bills. |
| **Taxes & service charge** | Percentages on the base subtotal (default CGST 2.5 %, SGST 2.5 %, service charge 5 %). Any number of each. |
| **Guest orders** | No login. Room/table must be in the configured list. Unavailable or deleted dishes are refused with a clear message. Priority is always *normal*. 6 orders/min per IP. Response carries a `guestToken` the device uses to follow its own order. |
| **Waiter orders** | Service/admin login; can set priority (urgent, priority, fast order, normal, no priority). |
| **Kitchen order** | Priority first, then oldest first (done on the page; the API returns newest first). |
| **Dish status** | queued → preparing → prepared → **ready** ("Serve dish": alerts the waiters) → served. **Re-prepare** from any later stage alerts everyone. Role rules in §4. |
| **Order status** | `completed` automatically when every dish is served; a re-prepare re-opens it. Admin can cancel or force-complete. |
| **Alerts** | Created by the server: new order, serve, re-prepare, priority change, cancel. Pushed live; kept 90 days. |
| **Audit** | `order_events` records every change with who did it (`GET /orders/{id}/events`). |
| **Content management** | Dishes: add, edit, price, veg/egg/non-veg, signature, available, sort order, delete. Photos: upload (multipart or data URL) → resized WebP in `UPLOAD_DIR`; old files removed on replace. |
| **Reports** | Today's KPIs (received, completed, cancelled, open, billed, average time, top dishes, by hour), any day, date range, CSV export. |

---

## 3. Data model (PostgreSQL)

`db/migrations/001_init.sql` is the source of truth.

| Table | Purpose |
|---|---|
| `menu_items` | Dishes (id slug, name, section, sub, description, price, veg, egg, signature, available, img, hero, sort_order) |
| `settings` | `billing` → `{taxes:[{name,rate}], charges:[…]}`; `access` → `{menuLink, rooms, tables}` |
| `staff_users` | name, role (`admin`/`kitchen`/`service`), bcrypt PIN hash, active, last_login |
| `orders` | code, location (room/table + number), source, priority, status, note, subtotal, taxes/charges JSON, total, guest_token, timestamps |
| `order_items` | one row per dish line: frozen name & price, qty, status, redo count, status time |
| `order_events` | audit trail |
| `alerts` | staff notifications |
| `schema_migrations` | applied migrations |

Add a migration as `db/migrations/002_xxx.sql`; it runs once, in a transaction, on the next start (`npm run migrate` to run it by hand).

---

## 4. Roles

| Action | kitchen | service | admin |
|---|:-:|:-:|:-:|
| See orders, alerts, today's stats | ✓ | ✓ | ✓ |
| Start / prepared / **Serve dish** (ready) | ✓ | | ✓ |
| Mark **served** | | ✓ (from ready) | ✓ |
| **Re-prepare** | ✓ | ✓ (ready/served) | ✓ |
| Place a waiter order with priority | | ✓ | ✓ |
| Change priority | | ✓ until the kitchen starts | ✓ |
| Cancel / force-complete order | | | ✓ |
| Menu, photos, taxes, charges, rooms/tables, staff, reports | | | ✓ |

Pages follow the same split: a Kitchen PIN opens only the Kitchen page, a Service PIN only the Service page,
an Admin PIN everything. Opening a page with the wrong login shows the PIN pad again.

Tokens are JWTs (12 h). Disabling a login or changing its role cuts it off within 30 s.
PINs are 4–6 digits (the pages use 4) and must be unique among active staff, because a PIN alone identifies the person.

---

## 5. Realtime

WebSocket at `/ws`.

* Staff: `/ws?token=<JWT>` → every event. An invalid token closes with code `4401`.
* Guests: `/ws` → `menu.updated`, `menu.deleted`, `settings.updated`; after sending
  `{"type":"track","tokens":["<guestToken>"]}` also `order.updated` for their own orders.

Server messages: `{"type": "...", "data": {...}, "at": <ms>}`

| type | data |
|---|---|
| `hello` | `{role}` |
| `order.created` / `order.updated` | full Order (same shape as the REST API) |
| `alert.created` | Alert |
| `menu.updated` / `menu.deleted` | Dish / `{id}` |
| `settings.updated` | Settings |

The pages reconnect automatically and also refresh every 30 s (every 2 min while connected) so nothing is missed.

**More than one API instance?** The event bus (`src/bus.js`) is in-process. Replace its two functions with
Postgres `LISTEN/NOTIFY` or Redis pub/sub; nothing else changes. Also move photos to object storage (`src/services/photos.js`).

---

## 6. Front-end integration (for the team stitching the app)

`public/index.html` is the full app (guest menu + three staff pages) built from the design you approved.

* `src/app.js` serves it at `/`, `/kitchen`, `/service`, `/admin` and injects
  `<script>window.PE_API={base:'/api/v1'}</script>` (plus `window.__START_ROUTE` for the staff pages).
* Inside the page, `makeApiStore()` talks to this API with the same small interface the page always used
  (`watchColl`, `watchDoc`, `set`, `update`, `del`) plus `createOrder`, `login`, `logout`, `staff.*`, `exportCsv`.
  Search the page for `makeApiStore` — it is the only place that knows URLs.
* Without `window.PE_API` (e.g. the file opened from disk) the page still runs in demo mode on the device.
* Hosting the page elsewhere (CDN, another app): set `window.PE_API={base:'https://api.example.com/api/v1', ws:'wss://api.example.com/ws'}`
  before the page script, list that site in `CORS_ORIGINS`, and set `PUBLIC_URL` so uploaded photo URLs are absolute.
* Building a native/mobile client instead: use `openapi.yaml`; the order/dish JSON is identical to what the pages use.

To refresh the page after design changes, replace `public/index.html` (and `public/photos`, `sketches`, `fonts`, videos).

---

## 7. Operations

* **Backups**: `pg_dump` the database daily and back up `UPLOAD_DIR`. Everything else is rebuilt from the repo.
* **HTTPS**: put nginx/Caddy/a cloud load balancer in front; forward `Upgrade` headers for `/ws`. Set `TRUST_PROXY`.
* **Health**: `GET /api/v1/health` (checks the database). The Docker image has a HEALTHCHECK.
* **Logs**: errors go to stderr as `[api] …`.
* **Housekeeping**: alerts older than 90 days are pruned automatically; orders and audit are kept.

## 8. Tests

```bash
createdb pines_test
DATABASE_URL=postgres://…/pines_test npm test     # wipes that database
```

13 integration tests cover: public endpoints, PIN login and roles, guest order pricing/bill/tracking,
validation, kitchen → serve → waiter → completed → re-prepare → reopened, bulk moves, priority rules,
cancel/complete, history/search/CSV/stats, tax changes vs frozen bills, content management with photo
upload, staff management and disabling, WebSocket delivery (staff vs guest isolation), page serving.

## 9. Layout

```
db/migrations/001_init.sql   schema
db/migrate.js  db/seed.js    migration runner, seed (menu-data.json, settings, starter staff)
seed/menu-data.json          the 112 dishes
src/server.js                start-up (migrate, seed, HTTP + WebSocket)
src/app.js                   Express app, security headers, page serving, error format
src/routes/api.js            every REST route
src/services/                menu, photos, settings, orders, alerts, staff, stats  (business rules live here)
src/realtime.js  src/bus.js  WebSocket fan-out, event bus
src/auth.js  src/billing.js  JWT + roles, bill maths
public/                      the front-end
openapi.yaml                 API spec
```
