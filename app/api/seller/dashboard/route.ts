import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { requireUser } from '@/lib/auth';

export const GET = route(async () => {
  const s = await requireUser(['seller']);
  const [metrics] = await query('SELECT * FROM seller_metrics WHERE seller_id = $1', [s.id]);
  const listings = await query(
    `SELECT listing_id, title, price, status, view_count, created_at
     FROM listings WHERE seller_id = $1 ORDER BY created_at DESC`,
    [s.id],
  );
  const orders = await query('SELECT * FROM v_order_summary WHERE seller_id = $1 ORDER BY placed_at DESC', [s.id]);
  return ok({ metrics, listings, orders });
});
