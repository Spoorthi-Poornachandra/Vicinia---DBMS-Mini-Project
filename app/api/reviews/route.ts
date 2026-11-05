import { z } from 'zod';
import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { requireUser } from '@/lib/auth';
import { syncReviewToGraph } from '@/lib/graph';

const schema = z.object({
  orderId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

// The DB trigger review_integrity enforces: reviewer is the buyer, order is delivered, seller matches.
export const POST = route(async (req) => {
  const s = await requireUser(['buyer', 'seller']);
  const b = schema.parse(await req.json());
  const rows = await query<{ seller_id: number }>('SELECT seller_id FROM orders WHERE order_id = $1', [b.orderId]);
  const sellerId = rows[0]?.seller_id ?? -1;
  await query(
    'INSERT INTO reviews (order_id, reviewer_id, seller_id, rating, comment) VALUES ($1,$2,$3,$4,$5)',
    [b.orderId, s.id, sellerId, b.rating, b.comment ?? null],
  );
  await syncReviewToGraph({ orderId: b.orderId, reviewerId: s.id, sellerId, rating: b.rating });
  return ok({ ok: true }, 201);
});
