-- ========================================================
-- Pines Exotica & Whispering Pines Homestay Database Schema
-- Compatible with PostgreSQL 12+ & pgAdmin 4
-- ========================================================

-- 1. Menu Items Table (112 Dishes)
CREATE TABLE IF NOT EXISTS menu_items (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    section VARCHAR(100) NOT NULL,
    sub VARCHAR(100) DEFAULT '',
    veg BOOLEAN DEFAULT TRUE,
    egg BOOLEAN DEFAULT FALSE,
    price NUMERIC(10, 2) NOT NULL,
    description TEXT,
    signature BOOLEAN DEFAULT FALSE,
    available BOOLEAN DEFAULT TRUE,
    img VARCHAR(255),
    hero VARCHAR(255),
    display_order INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_menu_section ON menu_items(section);
CREATE INDEX IF NOT EXISTS idx_menu_available ON menu_items(available);

-- 2. Orders Table (Live & Historical Orders)
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(100) PRIMARY KEY,
    code VARCHAR(50),
    source VARCHAR(50) DEFAULT 'guest',
    location_type VARCHAR(50) NOT NULL,       -- 'room' or 'table'
    location_number VARCHAR(50) NOT NULL,     -- e.g. '104', '5'
    priority VARCHAR(50) DEFAULT 'normal',    -- 'urgent', 'priority', 'fast', 'normal', 'none'
    status VARCHAR(50) DEFAULT 'open',        -- 'open', 'completed', 'cancelled'
    note TEXT DEFAULT '',
    items JSONB NOT NULL DEFAULT '[]',        -- List of ordered dishes with status & redo counts
    bill JSONB NOT NULL DEFAULT '{}',         -- Bill calculation (subtotal, taxes, charges, total)
    created_at BIGINT NOT NULL,               -- Unix epoch timestamp (milliseconds)
    updated_at BIGINT NOT NULL,
    completed_at BIGINT,
    cancelled_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_location ON orders(location_type, location_number);

-- 3. Alerts Table (Kitchen & Room Service Notifications)
CREATE TABLE IF NOT EXISTS alerts (
    id VARCHAR(100) PRIMARY KEY,
    order_id VARCHAR(100),
    code VARCHAR(50),
    location_type VARCHAR(50),
    location_number VARCHAR(50),
    kind VARCHAR(50),                         -- 'new', 'serve', 'reprepare'
    text TEXT,
    created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at DESC);

-- 4. Settings Table (Billing, Taxes, Staff PIN)
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
