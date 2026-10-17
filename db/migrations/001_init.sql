-- Pines Exotica · ordering backend · initial schema
-- PostgreSQL 14+

CREATE TYPE staff_role     AS ENUM ('admin', 'kitchen', 'service');
CREATE TYPE order_source   AS ENUM ('guest', 'waiter');
CREATE TYPE order_priority AS ENUM ('urgent', 'priority', 'fast', 'normal', 'none');
CREATE TYPE order_status   AS ENUM ('open', 'completed', 'cancelled');
CREATE TYPE item_status    AS ENUM ('queued', 'preparing', 'prepared', 'ready', 'served', 'reprepare');
CREATE TYPE loc_type       AS ENUM ('room', 'table');
CREATE TYPE alert_kind     AS ENUM ('new', 'serve', 'reprepare', 'priority', 'cancel');

-- ---------------------------------------------------------------- menu (content management)
CREATE TABLE menu_items (
  id           text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name         text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  section      text NOT NULL CHECK (length(section) BETWEEN 1 AND 80),
  sub          text NOT NULL DEFAULT '',
  description  text NOT NULL DEFAULT '',
  price        numeric(10,2) NOT NULL CHECK (price >= 0),
  veg          boolean NOT NULL DEFAULT true,
  egg          boolean NOT NULL DEFAULT false,
  signature    boolean NOT NULL DEFAULT false,
  available    boolean NOT NULL DEFAULT true,
  img          text NOT NULL DEFAULT '',      -- card photo path/URL ('' = drawn illustration)
  hero         text NOT NULL DEFAULT '',      -- optional large photo for feature pages
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_items_sort ON menu_items (sort_order, name);

-- ---------------------------------------------------------------- settings (key/value)
-- keys: 'billing' {taxes:[{name,rate}], charges:[{name,rate}]}
--       'access'  {menuLink, rooms, tables}
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- staff
CREATE TABLE staff_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  role        staff_role NOT NULL,
  pin_hash    text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  last_login  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- orders
CREATE TABLE orders (
  id            text PRIMARY KEY,
  code          text NOT NULL,                       -- short code shown to guest & staff (e.g. K7PQ)
  loc_type      loc_type NOT NULL,
  loc_num       text NOT NULL CHECK (loc_num ~ '^[A-Z0-9._~-]{1,12}$'),
  source        order_source NOT NULL,
  priority      order_priority NOT NULL DEFAULT 'normal',
  status        order_status NOT NULL DEFAULT 'open',
  note          text NOT NULL DEFAULT '',
  subtotal      numeric(12,2) NOT NULL,
  taxes         jsonb NOT NULL DEFAULT '[]',         -- [{name,rate,amount}] frozen at order time
  charges       jsonb NOT NULL DEFAULT '[]',
  total         numeric(12,2) NOT NULL,
  guest_token   text,                                -- lets the guest device follow its own order
  created_by    uuid REFERENCES staff_users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz,
  cancelled_at  timestamptz
);
CREATE INDEX orders_created ON orders (created_at DESC);
CREATE INDEX orders_open ON orders (status) WHERE status = 'open';
CREATE INDEX orders_guest_token ON orders (guest_token) WHERE guest_token IS NOT NULL;
CREATE INDEX orders_code ON orders (code);

CREATE TABLE order_items (
  id            text NOT NULL,                       -- line key ("k" in the API)
  order_id      text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id  text,                                -- no FK: dishes can be deleted, history stays
  name          text NOT NULL,                       -- frozen name & price at order time
  price         numeric(10,2) NOT NULL,
  qty           integer NOT NULL CHECK (qty BETWEEN 1 AND 50),
  veg           boolean NOT NULL DEFAULT true,
  egg           boolean NOT NULL DEFAULT false,
  status        item_status NOT NULL DEFAULT 'queued',
  redo          integer NOT NULL DEFAULT 0,          -- how many times sent back for re-prepare
  position      integer NOT NULL,
  status_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, id)
);

-- audit trail: every status / priority change, who did it, when
CREATE TABLE order_events (
  id          bigserial PRIMARY KEY,
  order_id    text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  item_ids    text[],
  action      text NOT NULL,          -- created | item_status | priority | cancel | complete | reopen
  from_value  text,
  to_value    text,
  actor_id    uuid REFERENCES staff_users(id),
  actor_role  text,                   -- guest | admin | kitchen | service
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order ON order_events (order_id, at);

-- ---------------------------------------------------------------- notifications
CREATE TABLE alerts (
  id          bigserial PRIMARY KEY,
  kind        alert_kind NOT NULL,
  order_id    text REFERENCES orders(id) ON DELETE CASCADE,
  code        text,
  loc_type    loc_type,
  loc_num     text,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX alerts_created ON alerts (created_at DESC);
