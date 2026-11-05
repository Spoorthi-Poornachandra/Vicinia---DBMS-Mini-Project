// Concurrency test: two buyers try to purchase the SAME listing at the same instant.
// Expected: exactly one order is created, the other buyer gets "no longer available".
// Usage:  node --env-file=.env tests/concurrency.mjs
import pg from 'pg';

const cfg = {
  host: process.env.PG_HOST, port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER, password: process.env.PG_PASSWORD, database: process.env.PG_DATABASE,
};
const setup = new pg.Client(cfg);
await setup.connect();

// fresh listing owned by seller 5 so the test is repeatable
const { rows } = await setup.query(
  `INSERT INTO listings (seller_id, category_id, title, price, location)
   VALUES (5, 1, 'Race-condition test table', 1000, ST_SetSRID(ST_MakePoint(77.64, 12.91), 4326)::geography)
   RETURNING listing_id`);
const listingId = rows[0].listing_id;

async function buy(buyerId, isolation) {
  const c = new pg.Client(cfg);
  await c.connect();
  try {
    await c.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const r = await c.query('SELECT purchase_listing($1, $2) AS order_id', [buyerId, listingId]);
    await new Promise((res) => setTimeout(res, 300)); // hold the lock a moment to force contention
    await c.query('COMMIT');
    return { buyerId, ok: true, orderId: r.rows[0].order_id };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return { buyerId, ok: false, error: e.message };
  } finally { await c.end(); }
}

for (const isolation of ['READ COMMITTED']) {
  const results = await Promise.all([buy(2, isolation), buy(3, isolation)]);
  console.log(isolation, results);
  const wins = results.filter((r) => r.ok).length;
  const { rows: items } = await setup.query('SELECT count(*)::int AS n FROM order_items WHERE listing_id = $1', [listingId]);
  const pass = wins === 1 && items[0].n === 1;
  console.log(pass ? 'PASS: exactly one buyer won' : `FAIL: wins=${wins}, order_items=${items[0].n}`);
  process.exitCode = pass ? 0 : 1;
}

// cleanup: remove the test order + listing
await setup.query('DELETE FROM reviews WHERE order_id IN (SELECT order_id FROM order_items WHERE listing_id = $1)', [listingId]);
await setup.query('DELETE FROM orders WHERE order_id IN (SELECT order_id FROM order_items WHERE listing_id = $1)', [listingId]);
await setup.query('DELETE FROM listings WHERE listing_id = $1', [listingId]);
await setup.end();
