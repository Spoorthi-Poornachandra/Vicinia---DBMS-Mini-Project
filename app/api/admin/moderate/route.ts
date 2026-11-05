import { z } from 'zod';
import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { requireUser } from '@/lib/auth';

const schema = z.object({ sellerId: z.number().int().positive() });

// Admin moderation: take down all of a seller's active listings.
export const POST = route(async (req) => {
  await requireUser(['admin']);
  const b = schema.parse(await req.json());
  const rows = await query(
    `UPDATE listings SET status = 'removed' WHERE seller_id = $1 AND status = 'active' RETURNING listing_id`,
    [b.sellerId],
  );
  return ok({ removed: rows.length });
});
