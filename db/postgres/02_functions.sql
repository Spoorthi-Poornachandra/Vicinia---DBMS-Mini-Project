-- =====================================================================
-- Vicinia :: Functions, stored procedures, triggers
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Seller score
--    score = 40% rating + 25% (1 - return rate) + 20% responsiveness + 15% graph trust
--    Result is 0..100 (x0.25 if flagged as part of a collusion ring).
--    Called by triggers; feeds search ranking.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_seller_score(p_seller BIGINT)
RETURNS NUMERIC AS $$
DECLARE
    m seller_metrics%ROWTYPE;
    rating_part  NUMERIC;
    return_part  NUMERIC;
    resp_part    NUMERIC;
    trust_part   NUMERIC;
    final_score  NUMERIC;
BEGIN
    SELECT * INTO m FROM seller_metrics WHERE seller_id = p_seller;
    IF NOT FOUND THEN RETURN 50; END IF;

    -- rating: 0..5 -> 0..100; shrink toward neutral (3.0) when there are few reviews
    rating_part := ((m.avg_rating * m.review_count + 3.0 * 5) / (m.review_count + 5)) / 5 * 100;
    -- return rate: 0% returns -> 100, 50%+ returns -> 0
    return_part := 100 * GREATEST(0, 1 - 2 * CASE WHEN m.orders_total = 0 THEN 0
                                                   ELSE m.orders_returned::NUMERIC / m.orders_total END);
    -- response time: <=10 min -> 100, >=24h -> 0 (linear), no data -> neutral 50
    resp_part := CASE WHEN m.avg_response_mins = 0 THEN 50
                      ELSE 100 * GREATEST(0, LEAST(1, (1440 - m.avg_response_mins) / (1440 - 10))) END;
    trust_part := LEAST(100, GREATEST(0, m.trust_boost));

    final_score := round(0.40 * rating_part + 0.25 * return_part + 0.20 * resp_part + 0.15 * trust_part, 2);
    -- sellers flagged by graph collusion detection are heavily demoted in search ranking
    IF m.is_flagged THEN final_score := round(final_score * 0.25, 2); END IF;
    RETURN final_score;
END;
$$ LANGUAGE plpgsql STABLE;

-- Recalculate one seller's metrics from raw tables and store the new score
CREATE OR REPLACE FUNCTION refresh_seller_metrics(p_seller BIGINT)
RETURNS VOID AS $$
BEGIN
    INSERT INTO seller_metrics (seller_id) VALUES (p_seller) ON CONFLICT DO NOTHING;

    UPDATE seller_metrics sm SET
        avg_rating      = COALESCE((SELECT round(avg(rating), 2) FROM reviews WHERE seller_id = p_seller), 0),
        review_count    = (SELECT count(*) FROM reviews WHERE seller_id = p_seller),
        orders_total    = (SELECT count(*) FROM orders WHERE seller_id = p_seller AND status <> 'cancelled'),
        orders_returned = (SELECT count(*) FROM orders WHERE seller_id = p_seller AND status = 'returned'),
        -- response time: gap between a buyer's first message on a listing and the seller's first reply
        avg_response_mins = COALESCE((
            SELECT round(avg(EXTRACT(EPOCH FROM (reply.t - q.t)) / 60)::NUMERIC, 2)
            FROM (SELECT msg.listing_id, msg.sender_id, min(msg.sent_at) AS t
                  FROM messages msg JOIN listings l ON l.listing_id = msg.listing_id
                  WHERE l.seller_id = p_seller AND msg.sender_id <> p_seller
                  GROUP BY msg.listing_id, msg.sender_id) q
            JOIN LATERAL (SELECT min(r.sent_at) AS t FROM messages r
                          WHERE r.listing_id = q.listing_id AND r.sender_id = p_seller
                            AND r.receiver_id = q.sender_id AND r.sent_at > q.t) reply ON reply.t IS NOT NULL
        ), 0),
        updated_at = now()
    WHERE sm.seller_id = p_seller;

    UPDATE seller_metrics SET seller_score = compute_seller_score(p_seller)
    WHERE seller_id = p_seller;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 2. Triggers
-- ---------------------------------------------------------------------

-- 2a. Create a metrics row automatically for every new seller
CREATE OR REPLACE FUNCTION trg_user_seller_metrics() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role = 'seller' THEN
        INSERT INTO seller_metrics (seller_id) VALUES (NEW.user_id) ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER user_seller_metrics
AFTER INSERT OR UPDATE OF role ON users
FOR EACH ROW EXECUTE FUNCTION trg_user_seller_metrics();

-- 2b. New / changed review -> recompute seller score
CREATE OR REPLACE FUNCTION trg_review_score() RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_seller_metrics(COALESCE(NEW.seller_id, OLD.seller_id));
    RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER review_changes_score
AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION trg_review_score();

-- 2c. Order inserted / status changed (e.g. returned) -> recompute seller score
CREATE OR REPLACE FUNCTION trg_order_score() RETURNS TRIGGER AS $$
BEGIN
    PERFORM refresh_seller_metrics(NEW.seller_id);
    RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER order_changes_score
AFTER INSERT OR UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION trg_order_score();

-- 2d. Log price changes (feeds dynamic pricing)
CREATE OR REPLACE FUNCTION trg_price_history() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.price IS DISTINCT FROM OLD.price THEN
        INSERT INTO price_history (listing_id, old_price, new_price)
        VALUES (OLD.listing_id, OLD.price, NEW.price);
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER listing_price_history
AFTER UPDATE OF price ON listings
FOR EACH ROW EXECUTE FUNCTION trg_price_history();

-- 2e. Integrity: only the buyer of a DELIVERED order can review it, and the seller must match
CREATE OR REPLACE FUNCTION trg_review_integrity() RETURNS TRIGGER AS $$
DECLARE o orders%ROWTYPE;
BEGIN
    SELECT * INTO o FROM orders WHERE order_id = NEW.order_id;
    IF o.buyer_id <> NEW.reviewer_id THEN
        RAISE EXCEPTION 'Only the buyer of order % may review it', NEW.order_id;
    END IF;
    IF o.seller_id <> NEW.seller_id THEN
        RAISE EXCEPTION 'Review seller does not match order seller';
    END IF;
    IF o.status <> 'delivered' THEN
        RAISE EXCEPTION 'Order % is not delivered yet (status: %)', NEW.order_id, o.status;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER review_integrity
BEFORE INSERT ON reviews
FOR EACH ROW EXECUTE FUNCTION trg_review_integrity();

-- 2f. A seller's listing must not be edited once sold
CREATE OR REPLACE FUNCTION trg_block_sold_edit() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'sold' AND NEW.status <> 'sold' THEN
        RAISE EXCEPTION 'Listing % is already sold and cannot be reopened', OLD.listing_id;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER listing_block_sold_edit
BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION trg_block_sold_edit();

-- ---------------------------------------------------------------------
-- 3. Delivery-time estimate
--    hours = zone.base_hours + zone.per_km_hours * distance_km(listing -> buyer)
--    Zone is the polygon that contains the buyer's location (falls back to nearest zone).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION estimate_delivery(p_listing BIGINT, p_buyer_location GEOGRAPHY)
RETURNS TABLE (zone_id INT, zone_name TEXT, distance_km NUMERIC, est_hours NUMERIC) AS $$
    SELECT z.zone_id, z.name::TEXT,
           round((ST_Distance(l.location, p_buyer_location) / 1000)::NUMERIC, 2),
           round(z.base_hours + z.per_km_hours * (ST_Distance(l.location, p_buyer_location) / 1000)::NUMERIC, 1)
    FROM listings l
    CROSS JOIN LATERAL (
        SELECT * FROM delivery_zones dz
        ORDER BY (NOT ST_Covers(dz.boundary, p_buyer_location)), dz.boundary <-> p_buyer_location
        LIMIT 1
    ) z
    WHERE l.listing_id = p_listing;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- 4. Race-condition-safe purchase
--
--    Two buyers click "Buy" on the same couch at the same moment.
--    SELECT ... FOR UPDATE takes a row lock on the listing: the second
--    transaction BLOCKS until the first commits, then re-reads status='sold'
--    and fails cleanly.  The UNIQUE(listing_id) on order_items is a second
--    safety net at the schema level.
--
--    Caller should run this inside a transaction with
--    ISOLATION LEVEL READ COMMITTED (default; sufficient because the row
--    lock serialises the contested row) -- see docs for the REPEATABLE READ variant.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION purchase_listing(p_buyer BIGINT, p_listing BIGINT)
RETURNS BIGINT AS $$
DECLARE
    l        listings%ROWTYPE;
    buyer    users%ROWTYPE;
    v_zone   INT;
    v_hours  NUMERIC;
    v_order  BIGINT;
BEGIN
    SELECT * INTO buyer FROM users WHERE user_id = p_buyer AND role IN ('buyer','seller');
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown buyer %', p_buyer; END IF;

    -- Row-level lock: concurrent purchasers queue here
    SELECT * INTO l FROM listings WHERE listing_id = p_listing FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Listing % does not exist', p_listing; END IF;
    IF l.status <> 'active' THEN
        RAISE EXCEPTION 'Listing % is no longer available (status: %)', p_listing, l.status
            USING ERRCODE = 'P0001';
    END IF;
    IF l.seller_id = p_buyer THEN
        RAISE EXCEPTION 'You cannot buy your own listing';
    END IF;

    SELECT e.zone_id, e.est_hours INTO v_zone, v_hours FROM estimate_delivery(p_listing, buyer.location) e;

    INSERT INTO orders (buyer_id, seller_id, total_amount, zone_id, est_hours)
    VALUES (p_buyer, l.seller_id, l.price, v_zone, v_hours)
    RETURNING order_id INTO v_order;

    INSERT INTO order_items (order_id, listing_id, unit_price) VALUES (v_order, p_listing, l.price);
    UPDATE listings SET status = 'sold' WHERE listing_id = p_listing;

    RETURN v_order;
END;
$$ LANGUAGE plpgsql;

-- Mark an order delivered / returned (re-opens nothing; just state change + score refresh via trigger)
CREATE OR REPLACE PROCEDURE set_order_status(p_order BIGINT, p_status order_status)
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE orders
       SET status = p_status,
           delivered_at = CASE WHEN p_status = 'delivered' THEN now() ELSE delivered_at END
     WHERE order_id = p_order;
    IF NOT FOUND THEN RAISE EXCEPTION 'Order % not found', p_order; END IF;
END; $$;

-- ---------------------------------------------------------------------
-- 5. Proximity search (spatial index + dynamic ranking)
--    rank = 0.6 * seller_score/100 + 0.4 * (1 - distance/radius)
--    Uses ST_DWithin (index-assisted filter) then sorts by blended rank.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_nearby(
    p_lat DOUBLE PRECISION, p_lon DOUBLE PRECISION, p_radius_m DOUBLE PRECISION DEFAULT 5000,
    p_category INT DEFAULT NULL, p_min_price NUMERIC DEFAULT NULL, p_max_price NUMERIC DEFAULT NULL,
    p_min_rating NUMERIC DEFAULT NULL, p_query TEXT DEFAULT NULL,
    p_sort TEXT DEFAULT 'rank', p_limit INT DEFAULT 50)
RETURNS TABLE (listing_id BIGINT, title TEXT, price NUMERIC, category TEXT, condition TEXT,
               seller_id BIGINT, seller_name TEXT, seller_score NUMERIC, avg_rating NUMERIC,
               seller_flagged BOOLEAN, distance_m DOUBLE PRECISION, rank_score DOUBLE PRECISION,
               lat DOUBLE PRECISION, lon DOUBLE PRECISION) AS $$
    WITH origin AS (SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography AS g)
    SELECT v.listing_id, v.title::TEXT, v.price, v.category::TEXT, v.condition::TEXT,
           v.seller_id, v.seller_name::TEXT, v.seller_score, v.avg_rating, v.seller_flagged,
           ST_Distance(v.location, o.g) AS distance_m,
           (0.6 * v.seller_score / 100.0 + 0.4 * (1 - ST_Distance(v.location, o.g) / p_radius_m))::DOUBLE PRECISION AS rank_score,
           ST_Y(v.location::geometry), ST_X(v.location::geometry)
    FROM v_listing_search v, origin o
    WHERE v.status = 'active'
      AND ST_DWithin(v.location, o.g, p_radius_m)
      AND (p_category  IS NULL OR v.category_id = p_category)
      AND (p_min_price IS NULL OR v.price >= p_min_price)
      AND (p_max_price IS NULL OR v.price <= p_max_price)
      AND (p_min_rating IS NULL OR v.avg_rating >= p_min_rating)
      AND (p_query IS NULL OR v.search_vec @@ plainto_tsquery('english', p_query))
    ORDER BY CASE p_sort WHEN 'price_asc'  THEN v.price END ASC,
             CASE p_sort WHEN 'price_desc' THEN v.price END DESC,
             CASE p_sort WHEN 'distance'   THEN ST_Distance(v.location, o.g) END ASC,
             (0.6 * v.seller_score / 100.0 + 0.4 * (1 - ST_Distance(v.location, o.g) / p_radius_m)) DESC
    LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- 6. Dynamic pricing hint
--    Compares demand (distinct interested buyers) vs supply in ~1km cells around the listing.
--    ratio > 2 -> suggest +10%; ratio < 0.5 -> suggest -10%; otherwise hold.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pricing_hint(p_listing BIGINT)
RETURNS TABLE (current_price NUMERIC, area_avg_price NUMERIC, demand INT, supply INT,
               demand_supply_ratio NUMERIC, suggested_price NUMERIC, hint TEXT) AS $$
    WITH me AS (SELECT * FROM listings WHERE listing_id = p_listing),
    area AS (
        SELECT COALESCE(sum(c.interested_buyers), 0)::INT AS demand,
               COALESCE(sum(c.active_supply), 0)::INT     AS supply,
               avg(c.avg_price)                            AS avg_price
        FROM me
        JOIN mv_demand_by_cell c
          ON c.category_id = me.category_id
         AND ST_DWithin(c.cell::geography, me.location, 2000)
    )
    SELECT me.price, round(a.avg_price, 2), a.demand, a.supply,
           round(a.demand::NUMERIC / GREATEST(a.supply, 1), 2),
           CASE WHEN a.demand::NUMERIC / GREATEST(a.supply, 1) > 2   THEN round(me.price * 1.10, 2)
                WHEN a.demand::NUMERIC / GREATEST(a.supply, 1) < 0.5 THEN round(me.price * 0.90, 2)
                ELSE me.price END,
           CASE WHEN a.demand::NUMERIC / GREATEST(a.supply, 1) > 2   THEN 'High demand nearby: consider raising the price ~10%'
                WHEN a.demand::NUMERIC / GREATEST(a.supply, 1) < 0.5 THEN 'Low demand nearby: a ~10% cut may help it sell'
                ELSE 'Price is in line with local demand' END
    FROM me, area a;
$$ LANGUAGE sql STABLE;

-- Sync endpoint: Neo4j pushes graph trust (0..100) and collusion flag back into Postgres
CREATE OR REPLACE FUNCTION apply_graph_signals(p_seller BIGINT, p_trust NUMERIC, p_flagged BOOLEAN)
RETURNS VOID AS $$
BEGIN
    INSERT INTO seller_metrics (seller_id) VALUES (p_seller) ON CONFLICT DO NOTHING;
    UPDATE seller_metrics
       SET trust_boost = LEAST(100, GREATEST(0, p_trust)), is_flagged = p_flagged
     WHERE seller_id = p_seller;
    PERFORM refresh_seller_metrics(p_seller);
END; $$ LANGUAGE plpgsql;
