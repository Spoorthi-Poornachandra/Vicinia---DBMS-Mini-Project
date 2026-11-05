import { z } from 'zod';
import { route, ok } from '@/lib/http';
import { query, tx } from '@/lib/pg';
import { requireUser } from '@/lib/auth';
import { syncOrderToGraph } from '@/lib/graph';

// GET /api/orders -> orders where I'm buyer or seller (from view), plus whether I already reviewed
export const GET = route(async () => {
  const s = await requireUser();
  const rows = await query(
    `SELECT v.*, (r.review_id IS NOT NULL) AS reviewed
     FROM v_order_summary v LEFT JOIN reviews r ON r.order_id = v.order_id
     WHERE v.buyer_id = $1 OR v.seller_id = $1
     ORDER BY v.placed_at DESC`,
    [s.id],
  );
  return ok({ me: s.id, orders: rows });
});

const schema = z.object({
  listingId: z.number().int().positive(),
  isolation: z.enum(['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE']).default('READ COMMITTED'),
});

/**
 * Buy a listing. purchase_listing() takes SELECT ... FOR UPDATE on the listing row, so two buyers
 * racing for the same item are serialised: the loser gets 409 "no longer available".
 */
export const POST = route(async (req) => {
  const s = await requireUser(['buyer', 'seller']);
  const b = schema.parse(await req.json());

  const orderId = await tx(async (c) => {
    const r = await c.query('SELECT purchase_listing($1, $2) AS order_id', [s.id, b.listingId]);
    return r.rows[0].order_id as number;
  }, b.isolation);

  const [o] = await query<{ seller_id: number; total_amount: number }>(
    'SELECT seller_id, total_amount FROM orders WHERE order_id = $1',
    [orderId],
  );
  // after the PostgreSQL commit, mirror the sale into the graph + refresh demand stats
  const graphSynced = await syncOrderToGraph({ orderId, buyerId: s.id, sellerId: o.seller_id, amount: o.total_amount });
  await query('REFRESH MATERIALIZED VIEW mv_demand_by_cell');
  return ok({ orderId, graphSynced }, 201);
});
