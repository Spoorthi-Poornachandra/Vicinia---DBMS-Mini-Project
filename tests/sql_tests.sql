-- =====================================================================
-- Vicinia :: SQL test cases. Run after the seed:  psql -f tests/sql_tests.sql
-- Each block prints PASS or raises an exception. Everything is rolled back at the end.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

-- T1: spatial search returns only listings inside the radius, nearest-first when sorted by distance
DO $$ DECLARE bad INT; BEGIN
  SELECT count(*) INTO bad FROM search_nearby(12.9784, 77.6408, 3000, NULL, NULL, NULL, NULL, NULL, 'distance', 50)
   WHERE distance_m > 3000;
  IF bad > 0 THEN RAISE EXCEPTION 'T1 FAIL: % results outside radius', bad; END IF;
  RAISE NOTICE 'T1 PASS: all results within radius';
END $$;

-- T2: sold listings never appear in search
DO $$ DECLARE n INT; BEGIN
  SELECT count(*) INTO n FROM search_nearby(12.9500, 77.6100, 20000, NULL, NULL, NULL, NULL, NULL, 'rank', 100) WHERE title = 'Used earphones';
  IF n > 0 THEN RAISE EXCEPTION 'T2 FAIL: sold item returned'; END IF;
  RAISE NOTICE 'T2 PASS: sold items hidden';
END $$;

-- T3: purchase marks listing sold, creates order+item, second purchase fails
DO $$ DECLARE o BIGINT; ok BOOLEAN := FALSE; BEGIN
  o := purchase_listing(2, 2);
  IF (SELECT status FROM listings WHERE listing_id = 2) <> 'sold' THEN RAISE EXCEPTION 'T3 FAIL: not sold'; END IF;
  BEGIN PERFORM purchase_listing(3, 2);
  EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'T3 FAIL: double purchase allowed'; END IF;
  RAISE NOTICE 'T3 PASS: purchase + double-purchase rejected';
END $$;

-- T4: cannot buy your own listing
DO $$ DECLARE ok BOOLEAN := FALSE; BEGIN
  BEGIN PERFORM purchase_listing(5, 1); EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'T4 FAIL'; END IF;
  RAISE NOTICE 'T4 PASS: self-purchase rejected';
END $$;

-- T5: review only allowed on delivered orders (order 3 was returned)
DO $$ DECLARE ok BOOLEAN := FALSE; BEGIN
  BEGIN INSERT INTO reviews (order_id, reviewer_id, seller_id, rating) VALUES (3, 4, 7, 5);
  EXCEPTION WHEN OTHERS THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'T5 FAIL: review on undelivered order accepted'; END IF;
  RAISE NOTICE 'T5 PASS: review integrity trigger works';
END $$;

-- T6: a new review changes the seller score (trigger)
DO $$ DECLARE s_before NUMERIC; s_after NUMERIC; o BIGINT; BEGIN
  SELECT seller_score INTO s_before FROM seller_metrics WHERE seller_id = 5;
  o := purchase_listing(4, 3);                 -- Karthik buys Suresh's Dell laptop
  CALL set_order_status(o, 'delivered');
  INSERT INTO reviews (order_id, reviewer_id, seller_id, rating) VALUES (o, 4, 5, 1);
  SELECT seller_score INTO s_after FROM seller_metrics WHERE seller_id = 5;
  IF s_after = s_before THEN RAISE EXCEPTION 'T6 FAIL: score did not change (% -> %)', s_before, s_after; END IF;
  RAISE NOTICE 'T6 PASS: score % -> % after a 1-star review', s_before, s_after;
END $$;

-- T7: a return lowers the seller score
DO $$ DECLARE s_before NUMERIC; s_after NUMERIC; BEGIN
  SELECT seller_score INTO s_before FROM seller_metrics WHERE seller_id = 6;
  CALL set_order_status(1, 'returned');        -- order 1 was Divya's delivered sale
  SELECT seller_score INTO s_after FROM seller_metrics WHERE seller_id = 6;
  IF s_after >= s_before THEN RAISE EXCEPTION 'T7 FAIL: % -> %', s_before, s_after; END IF;
  RAISE NOTICE 'T7 PASS: return lowered score % -> %', s_before, s_after;
END $$;

-- T8: flagged sellers are demoted
DO $$ DECLARE s_before NUMERIC; s_after NUMERIC; BEGIN
  SELECT seller_score INTO s_before FROM seller_metrics WHERE seller_id = 8;
  PERFORM apply_graph_signals(8, 0, TRUE);
  SELECT seller_score INTO s_after FROM seller_metrics WHERE seller_id = 8;
  IF s_after >= s_before THEN RAISE EXCEPTION 'T8 FAIL: % -> %', s_before, s_after; END IF;
  RAISE NOTICE 'T8 PASS: flagged seller demoted % -> %', s_before, s_after;
END $$;

-- T9: CHECK constraints reject bad data
DO $$ DECLARE c INT := 0; BEGIN
  BEGIN INSERT INTO listings (seller_id, category_id, title, price, location) VALUES (5,1,'Valid title',-1, ST_GeogFromText('POINT(77 12)')); EXCEPTION WHEN check_violation THEN c := c + 1; END;
  BEGIN INSERT INTO reviews (order_id, reviewer_id, seller_id, rating) VALUES (2, 3, 5, 9); EXCEPTION WHEN OTHERS THEN c := c + 1; END;
  BEGIN INSERT INTO users (name,email,password_hash,location) VALUES ('Bad','not-an-email','x', ST_GeogFromText('POINT(77 12)')); EXCEPTION WHEN check_violation THEN c := c + 1; END;
  IF c <> 3 THEN RAISE EXCEPTION 'T9 FAIL: only % of 3 bad inserts rejected', c; END IF;
  RAISE NOTICE 'T9 PASS: DB-level validation rejects bad price, rating, email';
END $$;

-- T10: price change is logged
DO $$ BEGIN
  UPDATE listings SET price = price - 100 WHERE listing_id = 4;
  IF NOT EXISTS (SELECT 1 FROM price_history WHERE listing_id = 4) THEN RAISE EXCEPTION 'T10 FAIL'; END IF;
  RAISE NOTICE 'T10 PASS: price_history trigger';
END $$;

-- T11: delivery estimate returns a zone
DO $$ BEGIN
  IF (SELECT count(*) FROM estimate_delivery(1, ST_SetSRID(ST_MakePoint(77.75, 12.97), 4326)::geography)) <> 1 THEN RAISE EXCEPTION 'T11 FAIL'; END IF;
  RAISE NOTICE 'T11 PASS: delivery estimate';
END $$;

ROLLBACK;
