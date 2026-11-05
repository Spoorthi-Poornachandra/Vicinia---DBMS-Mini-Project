-- =====================================================================
-- Vicinia :: seed data (Bengaluru).  Demo password for every account: password123
-- Passwords are stored as bcrypt hashes via pgcrypto (bf), verifiable by bcryptjs.
-- Includes a planted collusion ring (users 8, 9, 10) for the fraud-detection demo.
-- =====================================================================

-- users: 1 admin | 2-4 buyers | 5-7 honest sellers | 8-10 collusion ring
INSERT INTO users (name, email, password_hash, role, location, phone) VALUES
 ('Asha Admin',    'admin@vicinia.test',   crypt('password123', gen_salt('bf', 10)), 'admin',  ST_SetSRID(ST_MakePoint(77.5946, 12.9716), 4326)::geography, '9000000001'),
 ('Ravi Buyer',    'ravi@vicinia.test',    crypt('password123', gen_salt('bf', 10)), 'buyer',  ST_SetSRID(ST_MakePoint(77.6408, 12.9784), 4326)::geography, '9000000002'),
 ('Meera Buyer',   'meera@vicinia.test',   crypt('password123', gen_salt('bf', 10)), 'buyer',  ST_SetSRID(ST_MakePoint(77.6245, 12.9352), 4326)::geography, '9000000003'),
 ('Karthik Buyer', 'karthik@vicinia.test', crypt('password123', gen_salt('bf', 10)), 'buyer',  ST_SetSRID(ST_MakePoint(77.7500, 12.9698), 4326)::geography, '9000000004'),
 ('Suresh Seller', 'suresh@vicinia.test',  crypt('password123', gen_salt('bf', 10)), 'seller', ST_SetSRID(ST_MakePoint(77.6389, 12.9116), 4326)::geography, '9000000005'),
 ('Divya Seller',  'divya@vicinia.test',   crypt('password123', gen_salt('bf', 10)), 'seller', ST_SetSRID(ST_MakePoint(77.5938, 12.9250), 4326)::geography, '9000000006'),
 ('Imran Seller',  'imran@vicinia.test',   crypt('password123', gen_salt('bf', 10)), 'seller', ST_SetSRID(ST_MakePoint(77.5710, 13.0035), 4326)::geography, '9000000007'),
 ('Ring Alpha',    'alpha@vicinia.test',   crypt('password123', gen_salt('bf', 10)), 'seller', ST_SetSRID(ST_MakePoint(77.6100, 12.9500), 4326)::geography, '9000000008'),
 ('Ring Beta',     'beta@vicinia.test',    crypt('password123', gen_salt('bf', 10)), 'seller', ST_SetSRID(ST_MakePoint(77.6150, 12.9550), 4326)::geography, '9000000009'),
 ('Ring Gamma',    'gamma@vicinia.test',   crypt('password123', gen_salt('bf', 10)), 'seller', ST_SetSRID(ST_MakePoint(77.6200, 12.9450), 4326)::geography, '9000000010');

INSERT INTO categories (name, parent_id) VALUES
 ('Furniture', NULL), ('Electronics', NULL), ('Appliances', NULL), ('Books', NULL),   -- 1..4
 ('Sofas', 1), ('Laptops', 2), ('Phones', 2);                                          -- 5..7

INSERT INTO delivery_zones (name, boundary, base_hours, per_km_hours) VALUES
 ('Central', ST_MakeEnvelope(77.55, 12.90, 77.68, 13.02, 4326)::geography, 2.0, 0.20),
 ('East',    ST_MakeEnvelope(77.68, 12.90, 77.80, 13.05, 4326)::geography, 3.0, 0.25),
 ('South',   ST_MakeEnvelope(77.55, 12.80, 77.68, 12.90, 4326)::geography, 3.5, 0.25);

-- listings (location = seller's neighbourhood, slightly jittered)
INSERT INTO listings (seller_id, category_id, title, description, price, condition, status, location) VALUES
 (5, 5, '3-seater fabric couch',      'Grey fabric sofa, 2 years old, very comfortable couch',      8500, 'used',        'active', ST_SetSRID(ST_MakePoint(77.6390, 12.9120), 4326)::geography),
 (5, 1, 'Teak study table',           'Solid teak desk with drawer, minor scratches',               4200, 'used',        'active', ST_SetSRID(ST_MakePoint(77.6385, 12.9110), 4326)::geography),
 (5, 6, 'Dell Latitude laptop',       'i5, 8GB RAM, 256GB SSD, battery 4h',                        18500, 'refurbished', 'active', ST_SetSRID(ST_MakePoint(77.6395, 12.9125), 4326)::geography),
 (6, 5, 'Leather 2-seater sofa',      'Brown leather loveseat, no tears',                          12000, 'like_new',    'active', ST_SetSRID(ST_MakePoint(77.5940, 12.9255), 4326)::geography),
 (6, 3, 'Front-load washing machine', '7kg, 3 years old, working perfectly',                       14000, 'used',        'active', ST_SetSRID(ST_MakePoint(77.5935, 12.9245), 4326)::geography),
 (6, 4, 'Engineering textbook set',   'Complete set of CS textbooks, good condition',               1500, 'used',        'active', ST_SetSRID(ST_MakePoint(77.5942, 12.9248), 4326)::geography),
 (7, 7, 'iPhone 12 128GB',            'Blue, battery health 86%, with box',                        27000, 'used',        'active', ST_SetSRID(ST_MakePoint(77.5712, 13.0030), 4326)::geography),
 (7, 5, 'Corner sectional couch',     'Large L-shaped couch, beige, fits 5',                       15000, 'used',        'active', ST_SetSRID(ST_MakePoint(77.5708, 13.0038), 4326)::geography),
 (7, 2, 'Bluetooth speaker',          'JBL Flip, barely used',                                      3500, 'like_new',    'active', ST_SetSRID(ST_MakePoint(77.5715, 13.0033), 4326)::geography),
 (8, 2, 'Used earphones',             'wired earphones',                                             300, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.6100, 12.9500), 4326)::geography),
 (8, 2, 'Phone charger',              'fast charger',                                                250, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.6102, 12.9502), 4326)::geography),
 (9, 2, 'Mouse',                      'optical mouse',                                               200, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.6150, 12.9550), 4326)::geography),
 (9, 2, 'Keyboard',                   'usb keyboard',                                                350, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.6152, 12.9552), 4326)::geography),
 (10, 2,'USB cable',                  'type-c cable',                                                150, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.6200, 12.9450), 4326)::geography),
 (10, 2,'Power bank',                 '10000mAh',                                                    600, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.6202, 12.9452), 4326)::geography),
 (8, 5, 'Cheap couch (ring)',         'couch in good shape, best couch deal',                       3000, 'used',        'active', ST_SetSRID(ST_MakePoint(77.6105, 12.9505), 4326)::geography),
 (6, 5, 'Recliner couch',             'Single-seater recliner couch',                                9000, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.5941, 12.9251), 4326)::geography),
 (5, 6, 'Old ThinkPad',               'ThinkPad T450, works',                                        9000, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.6388, 12.9118), 4326)::geography),
 (7, 7, 'Pixel 4a',                   'Google Pixel 4a, screen replaced',                           11000, 'used',        'sold',   ST_SetSRID(ST_MakePoint(77.5711, 13.0034), 4326)::geography);

-- messages: buyer asks, seller replies (response time inputs)
INSERT INTO messages (listing_id, sender_id, receiver_id, body, sent_at) VALUES
 (1, 2, 5, 'Is the couch still available?',  now() - interval '5 days'),
 (1, 5, 2, 'Yes, come take a look.',         now() - interval '5 days' + interval '8 minutes'),
 (4, 3, 6, 'Can you deliver the sofa?',      now() - interval '4 days'),
 (4, 6, 3, 'Yes, within the zone.',          now() - interval '4 days' + interval '20 minutes'),
 (7, 2, 7, 'Is the battery original?',       now() - interval '3 days'),
 (7, 7, 2, 'Replaced last year.',            now() - interval '3 days' + interval '9 hours'),
 (8, 3, 7, 'Dimensions please',              now() - interval '2 days'),
 (8, 7, 3, '280cm x 180cm',                  now() - interval '2 days' + interval '14 hours'),
 (1, 3, 5, 'Would you take 7500?',           now() - interval '1 day'),
 (1, 4, 5, 'Interested in the couch.',       now() - interval '20 hours'),
 (16, 2, 8, 'Is this couch real?',           now() - interval '10 hours'),
 (16, 3, 8, 'Couch still there?',            now() - interval '9 hours');

-- helper to record a completed sale (order + item), used only for seeding
CREATE OR REPLACE FUNCTION _seed_sale(p_buyer BIGINT, p_listing BIGINT, p_status order_status, p_days_ago INT)
RETURNS BIGINT AS $$
DECLARE l listings%ROWTYPE; o BIGINT;
BEGIN
    SELECT * INTO l FROM listings WHERE listing_id = p_listing;
    INSERT INTO orders (buyer_id, seller_id, status, total_amount, placed_at, delivered_at)
    VALUES (p_buyer, l.seller_id, p_status, l.price, now() - make_interval(days => p_days_ago),
            CASE WHEN p_status IN ('delivered','returned') THEN now() - make_interval(days => p_days_ago - 1) END)
    RETURNING order_id INTO o;
    INSERT INTO order_items VALUES (o, p_listing, l.price);
    RETURN o;
END; $$ LANGUAGE plpgsql;

-- honest sales (orders 1-3)
SELECT _seed_sale(2, 17, 'delivered', 20);   -- Ravi   <- Divya  (recliner)
SELECT _seed_sale(3, 18, 'delivered', 15);   -- Meera  <- Suresh (ThinkPad)
SELECT _seed_sale(4, 19, 'returned',  12);   -- Karthik<- Imran  (Pixel, returned)

-- collusion ring (orders 4-9): Gamma<-Alpha, Beta<-Gamma, Alpha<-Beta ... closed loop of cheap items
SELECT _seed_sale(9,  10, 'delivered', 30);  -- Beta  buys from Alpha
SELECT _seed_sale(9,  11, 'delivered', 29);
SELECT _seed_sale(10, 12, 'delivered', 28);  -- Gamma buys from Beta
SELECT _seed_sale(10, 13, 'delivered', 27);
SELECT _seed_sale(8,  14, 'delivered', 26);  -- Alpha buys from Gamma
SELECT _seed_sale(8,  15, 'delivered', 25);

-- reviews (trigger enforces: reviewer = buyer, order delivered)
INSERT INTO reviews (order_id, reviewer_id, seller_id, rating, comment) VALUES
 (1, 2, 6, 5, 'Great sofa, exactly as described.'),
 (2, 3, 5, 4, 'Good laptop, a bit scratched.'),
 (4, 9, 8, 5, 'Perfect!'),
 (5, 9, 8, 5, 'Perfect!'),
 (6, 10, 9, 5, 'Perfect seller!'),
 (7, 10, 9, 5, 'Perfect seller!'),
 (8, 8, 10, 5, 'Perfect!'),
 (9, 8, 10, 5, 'Perfect!');

DROP FUNCTION _seed_sale(BIGINT, BIGINT, order_status, INT);

-- compute scores for everyone and build the demand materialised view
SELECT refresh_seller_metrics(user_id) FROM users WHERE role = 'seller';
REFRESH MATERIALIZED VIEW mv_demand_by_cell;
