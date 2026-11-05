-- =====================================================================
-- Vicinia :: PostgreSQL + PostGIS schema (DDL)
-- Run order: 01_schema.sql -> 02_functions.sql -> 03_seed.sql
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- crypt()/gen_salt() for seed password hashes

-- Clean re-run support (demonstrates DROP)
DROP MATERIALIZED VIEW IF EXISTS mv_demand_by_cell CASCADE;
DROP VIEW IF EXISTS v_listing_search CASCADE;
DROP VIEW IF EXISTS v_order_summary CASCADE;
DROP VIEW IF EXISTS v_seller_leaderboard CASCADE;
DROP TABLE IF EXISTS price_history CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS reviews CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS listings CASCADE;
DROP TABLE IF EXISTS seller_metrics CASCADE;
DROP TABLE IF EXISTS delivery_zones CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS listing_status CASCADE;
DROP TYPE IF EXISTS order_status CASCADE;

-- ---------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------
CREATE TYPE user_role      AS ENUM ('buyer', 'seller', 'admin');
CREATE TYPE listing_status AS ENUM ('active', 'reserved', 'sold', 'removed');
CREATE TYPE order_status   AS ENUM ('placed', 'delivered', 'returned', 'cancelled');

-- ---------------------------------------------------------------------
-- users  (location is a geography point -> distances in metres)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id        BIGSERIAL PRIMARY KEY,
    name           VARCHAR(100) NOT NULL CHECK (length(trim(name)) >= 2),
    email          VARCHAR(255) NOT NULL UNIQUE
                       CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    password_hash  TEXT         NOT NULL,                 -- bcrypt hash, never plain text
    role           user_role    NOT NULL DEFAULT 'buyer',
    location       GEOGRAPHY(Point, 4326) NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_location ON users USING GIST (location);

-- ---------------------------------------------------------------------
-- categories (self-referencing hierarchy)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
    category_id  SERIAL PRIMARY KEY,
    name         VARCHAR(80) NOT NULL UNIQUE,
    parent_id    INT REFERENCES categories(category_id) ON DELETE SET NULL
);

-- ---------------------------------------------------------------------
-- delivery_zones (polygon per zone, used for delivery-time estimation)
-- ---------------------------------------------------------------------
CREATE TABLE delivery_zones (
    zone_id        SERIAL PRIMARY KEY,
    name           VARCHAR(80) NOT NULL UNIQUE,
    boundary       GEOGRAPHY(Polygon, 4326) NOT NULL,
    base_hours     NUMERIC(5,2) NOT NULL CHECK (base_hours > 0),
    per_km_hours   NUMERIC(5,2) NOT NULL DEFAULT 0.15 CHECK (per_km_hours >= 0)
);
CREATE INDEX idx_zones_boundary ON delivery_zones USING GIST (boundary);

-- ---------------------------------------------------------------------
-- listings
-- ---------------------------------------------------------------------
CREATE TABLE listings (
    listing_id   BIGSERIAL PRIMARY KEY,
    seller_id    BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    category_id  INT    NOT NULL REFERENCES categories(category_id),
    title        VARCHAR(150) NOT NULL CHECK (length(trim(title)) >= 3),
    description  TEXT NOT NULL DEFAULT '',
    price        NUMERIC(10,2) NOT NULL CHECK (price > 0),
    condition    VARCHAR(20) NOT NULL DEFAULT 'used'
                     CHECK (condition IN ('new','like_new','used','refurbished')),
    status       listing_status NOT NULL DEFAULT 'active',
    location     GEOGRAPHY(Point, 4326) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    search_vec   TSVECTOR GENERATED ALWAYS AS
                     (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(description,''))) STORED
);
-- Spatial index: makes ST_DWithin / KNN (<->) use an index instead of full scan
CREATE INDEX idx_listings_location ON listings USING GIST (location);
-- Full-text search
CREATE INDEX idx_listings_fts      ON listings USING GIN (search_vec);
-- Partial index: the hot path only ever searches active listings
CREATE INDEX idx_listings_active_cat_price ON listings (category_id, price) WHERE status = 'active';
CREATE INDEX idx_listings_seller   ON listings (seller_id);

-- ---------------------------------------------------------------------
-- orders / order_items
-- ---------------------------------------------------------------------
CREATE TABLE orders (
    order_id      BIGSERIAL PRIMARY KEY,
    buyer_id      BIGINT NOT NULL REFERENCES users(user_id),
    seller_id     BIGINT NOT NULL REFERENCES users(user_id),
    status        order_status NOT NULL DEFAULT 'placed',
    total_amount  NUMERIC(10,2) NOT NULL CHECK (total_amount > 0),
    zone_id       INT REFERENCES delivery_zones(zone_id),
    est_hours     NUMERIC(6,2),
    placed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (buyer_id <> seller_id)           -- cannot buy your own listing
);
CREATE INDEX idx_orders_buyer  ON orders (buyer_id);
CREATE INDEX idx_orders_seller ON orders (seller_id, status);

CREATE TABLE order_items (
    order_id    BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    listing_id  BIGINT NOT NULL REFERENCES listings(listing_id),
    unit_price  NUMERIC(10,2) NOT NULL CHECK (unit_price > 0),
    PRIMARY KEY (order_id, listing_id),
    UNIQUE (listing_id)                      -- a one-off secondhand item can be sold only ONCE
);

-- ---------------------------------------------------------------------
-- reviews (one review per order)
-- ---------------------------------------------------------------------
CREATE TABLE reviews (
    review_id    BIGSERIAL PRIMARY KEY,
    order_id     BIGINT NOT NULL UNIQUE REFERENCES orders(order_id) ON DELETE CASCADE,
    reviewer_id  BIGINT NOT NULL REFERENCES users(user_id),
    seller_id    BIGINT NOT NULL REFERENCES users(user_id),
    rating       SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment      TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_seller ON reviews (seller_id);

-- ---------------------------------------------------------------------
-- messages (used to compute seller response time)
-- ---------------------------------------------------------------------
CREATE TABLE messages (
    message_id   BIGSERIAL PRIMARY KEY,
    listing_id   BIGINT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
    sender_id    BIGINT NOT NULL REFERENCES users(user_id),
    receiver_id  BIGINT NOT NULL REFERENCES users(user_id),
    body         TEXT NOT NULL CHECK (length(body) > 0),
    sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (sender_id <> receiver_id)
);
CREATE INDEX idx_messages_listing ON messages (listing_id, sent_at);

-- ---------------------------------------------------------------------
-- seller_metrics (denormalised, maintained by triggers/functions)
-- ---------------------------------------------------------------------
CREATE TABLE seller_metrics (
    seller_id          BIGINT PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
    avg_rating         NUMERIC(3,2)  NOT NULL DEFAULT 0 CHECK (avg_rating BETWEEN 0 AND 5),
    review_count       INT           NOT NULL DEFAULT 0 CHECK (review_count >= 0),
    orders_total       INT           NOT NULL DEFAULT 0 CHECK (orders_total >= 0),
    orders_returned    INT           NOT NULL DEFAULT 0 CHECK (orders_returned >= 0),
    avg_response_mins  NUMERIC(8,2)  NOT NULL DEFAULT 0 CHECK (avg_response_mins >= 0),
    trust_boost        NUMERIC(5,2)  NOT NULL DEFAULT 0,       -- pushed in from Neo4j (0..100)
    seller_score       NUMERIC(5,2)  NOT NULL DEFAULT 50 CHECK (seller_score BETWEEN 0 AND 100),
    is_flagged         BOOLEAN       NOT NULL DEFAULT FALSE,   -- set by collusion detection
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CHECK (orders_returned <= orders_total)
);

-- ---------------------------------------------------------------------
-- price_history (feeds dynamic pricing hints)
-- ---------------------------------------------------------------------
CREATE TABLE price_history (
    history_id   BIGSERIAL PRIMARY KEY,
    listing_id   BIGINT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
    old_price    NUMERIC(10,2) NOT NULL,
    new_price    NUMERIC(10,2) NOT NULL,
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- ALTER examples (schema evolution)
-- ---------------------------------------------------------------------
ALTER TABLE users    ADD COLUMN phone VARCHAR(20);
ALTER TABLE users    ADD CONSTRAINT chk_phone CHECK (phone IS NULL OR phone ~ '^[0-9+\- ]{7,20}$');
ALTER TABLE listings ADD COLUMN view_count INT NOT NULL DEFAULT 0 CHECK (view_count >= 0);
ALTER TABLE orders   ADD COLUMN delivered_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------

-- Search view: listing + seller score + seller location (ranking uses score)
CREATE VIEW v_listing_search AS
SELECT  l.listing_id, l.title, l.description, l.price, l.condition, l.status,
        l.category_id, c.name AS category, l.location, l.created_at, l.search_vec,
        l.seller_id, u.name AS seller_name,
        COALESCE(m.seller_score, 50) AS seller_score,
        COALESCE(m.avg_rating, 0)    AS avg_rating,
        COALESCE(m.is_flagged, FALSE) AS seller_flagged
FROM listings l
JOIN users u            ON u.user_id = l.seller_id
JOIN categories c       ON c.category_id = l.category_id
LEFT JOIN seller_metrics m ON m.seller_id = l.seller_id;

-- Order summary view
CREATE VIEW v_order_summary AS
SELECT  o.order_id, o.status, o.total_amount, o.placed_at, o.est_hours,
        b.user_id AS buyer_id,  b.name AS buyer_name,
        s.user_id AS seller_id, s.name AS seller_name,
        string_agg(l.title, ', ' ORDER BY l.title) AS items
FROM orders o
JOIN users b ON b.user_id = o.buyer_id
JOIN users s ON s.user_id = o.seller_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN listings l ON l.listing_id = oi.listing_id
GROUP BY o.order_id, b.user_id, b.name, s.user_id, s.name;

-- Seller leaderboard
CREATE VIEW v_seller_leaderboard AS
SELECT  u.user_id, u.name, m.seller_score, m.avg_rating, m.review_count,
        m.orders_total,
        CASE WHEN m.orders_total = 0 THEN 0
             ELSE round(100.0 * m.orders_returned / m.orders_total, 1) END AS return_rate_pct,
        m.avg_response_mins, m.is_flagged
FROM seller_metrics m JOIN users u ON u.user_id = m.seller_id
ORDER BY m.seller_score DESC;

-- Materialised view: demand per category per ~1km grid cell (dynamic pricing hints)
CREATE MATERIALIZED VIEW mv_demand_by_cell AS
SELECT  l.category_id,
        ST_SnapToGrid(l.location::geometry, 0.01) AS cell,          -- ~1.1 km grid
        count(*) FILTER (WHERE l.status = 'active')  AS active_supply,
        count(*) FILTER (WHERE l.status = 'sold')    AS sold_count,
        COALESCE(sum(m.buyers), 0)                   AS interested_buyers,
        round(avg(l.price), 2)                       AS avg_price
FROM listings l
-- pre-aggregate messages per listing so the join does not multiply listing rows
LEFT JOIN (SELECT listing_id, count(DISTINCT sender_id) AS buyers
           FROM messages GROUP BY listing_id) m ON m.listing_id = l.listing_id
GROUP BY l.category_id, ST_SnapToGrid(l.location::geometry, 0.01);
CREATE INDEX idx_mv_demand ON mv_demand_by_cell (category_id);
