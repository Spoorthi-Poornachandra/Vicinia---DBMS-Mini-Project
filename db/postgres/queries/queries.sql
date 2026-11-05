-- =====================================================================
-- Vicinia :: important queries (DML + analytics).  Run after 03_seed.sql
-- =====================================================================

-- Q1. Proximity search: couches within 5 km of Indiranagar, price<=15000, rating>=0,
--     ranked by blended seller score + distance.  Uses GiST index via ST_DWithin.
SELECT * FROM search_nearby(12.9784, 77.6408, 5000, NULL, NULL, 15000, NULL, 'couch', 'rank', 20);

-- Q1b. Same, sorted purely by distance, using the KNN operator (index-ordered nearest-first)
SELECT l.listing_id, l.title, l.price,
       round((l.location <-> ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography)::NUMERIC) AS dist_m
FROM listings l
WHERE l.status = 'active'
ORDER BY l.location <-> ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography
LIMIT 5;

-- Q2. EXPLAIN proof that the spatial index is used
EXPLAIN (ANALYZE, BUFFERS)
SELECT listing_id FROM listings
WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography, 5000);

-- Q3. Purchase (race-safe).  Returns new order id; second attempt fails with "no longer available"
-- BEGIN; SELECT purchase_listing(2, 1); COMMIT;

-- Q4. Seller leaderboard with return rate (JOIN + aggregate via view)
SELECT * FROM v_seller_leaderboard;

-- Q5. Sellers whose average rating is high but who have fewer than 3 distinct buyers
--     (GROUP BY / HAVING + COUNT DISTINCT) -- a simple red flag
SELECT o.seller_id, u.name, round(avg(r.rating), 2) AS avg_rating,
       count(DISTINCT o.buyer_id) AS distinct_buyers, count(*) AS orders
FROM orders o
JOIN users u        ON u.user_id = o.seller_id
JOIN reviews r      ON r.order_id = o.order_id
GROUP BY o.seller_id, u.name
HAVING avg(r.rating) >= 4.5 AND count(DISTINCT o.buyer_id) < 3
ORDER BY avg_rating DESC;

-- Q6. Subquery: listings priced below the average of their category
SELECT l.listing_id, l.title, l.price, c.name AS category
FROM listings l JOIN categories c ON c.category_id = l.category_id
WHERE l.status = 'active'
  AND l.price < (SELECT avg(price) FROM listings x WHERE x.category_id = l.category_id AND x.status = 'active')
ORDER BY l.price;

-- Q7. Revenue per seller per month (aggregate + date_trunc)
SELECT s.name AS seller, date_trunc('month', o.placed_at) AS month,
       count(*) AS orders, sum(o.total_amount) AS revenue
FROM orders o JOIN users s ON s.user_id = o.seller_id
WHERE o.status IN ('placed', 'delivered')
GROUP BY s.name, date_trunc('month', o.placed_at)
ORDER BY month DESC, revenue DESC;

-- Q8. "Bought this, also bought that" (SQL co-purchase; Neo4j gives the graph version)
SELECT l2.listing_id, l2.title, count(*) AS co_buyers
FROM order_items a
JOIN orders oa ON oa.order_id = a.order_id
JOIN orders ob ON ob.buyer_id = oa.buyer_id AND ob.order_id <> oa.order_id
JOIN order_items b ON b.order_id = ob.order_id
JOIN listings l1 ON l1.listing_id = a.listing_id
JOIN listings l2 ON l2.listing_id = b.listing_id AND l2.category_id = l1.category_id
WHERE a.listing_id = 10
GROUP BY l2.listing_id, l2.title
ORDER BY co_buyers DESC LIMIT 5;

-- Q9. Dynamic pricing hint + delivery estimate
SELECT * FROM pricing_hint(1);
SELECT * FROM estimate_delivery(1, ST_SetSRID(ST_MakePoint(77.7500, 12.9698), 4326)::geography);

-- Q10. Full-text search with ranking
SELECT listing_id, title, ts_rank(search_vec, q) AS rank
FROM listings, plainto_tsquery('english', 'leather sofa') q
WHERE search_vec @@ q ORDER BY rank DESC;

-- ---------------------------------------------------------------------
-- DML demonstrations
-- ---------------------------------------------------------------------
-- INSERT
INSERT INTO listings (seller_id, category_id, title, description, price, location)
VALUES (5, 1, 'Wooden bookshelf', '5-shelf, sturdy', 2500, ST_SetSRID(ST_MakePoint(77.6390, 12.9115), 4326)::geography);

-- UPDATE (fires price_history trigger)
UPDATE listings SET price = 2300 WHERE title = 'Wooden bookshelf';
SELECT * FROM price_history ORDER BY changed_at DESC LIMIT 3;

-- UPDATE: mark order returned (fires score trigger)
-- CALL set_order_status(3, 'returned');

-- DELETE (cascades to price_history)
DELETE FROM listings WHERE title = 'Wooden bookshelf';

-- Integrity demos (each should FAIL):
-- INSERT INTO listings (seller_id, category_id, title, price, location) VALUES (5,1,'x',-5, ST_GeogFromText('POINT(77 12)'));   -- price check + title length
-- INSERT INTO reviews (order_id, reviewer_id, seller_id, rating) VALUES (3, 4, 7, 5);                                          -- order not delivered
-- INSERT INTO order_items VALUES (1, 10, 300);                                                                                 -- listing already sold (UNIQUE)

-- ---------------------------------------------------------------------
-- CONCURRENCY DEMO (run in two psql sessions)
-- ---------------------------------------------------------------------
-- Session A:  BEGIN; SELECT purchase_listing(2, 1);        -- holds row lock, do NOT commit yet
-- Session B:  BEGIN; SELECT purchase_listing(3, 1);        -- BLOCKS waiting on A's lock
-- Session A:  COMMIT;                                       -- A wins
-- Session B:  -> ERROR: Listing 1 is no longer available (status: sold)
