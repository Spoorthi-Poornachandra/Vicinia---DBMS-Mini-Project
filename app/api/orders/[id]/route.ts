import { z } from 'zod';
import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { requireUser, HttpError } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };
const schema = z.object({ action: z.enum(['deliver', 'return']) });

// PATCH /api/orders/:id  { action }  — seller marks delivered; buyer returns a delivered order
export const PATCH = route<Ctx>(async (req, { params }) => {
  const s = await requireUser(['buyer', 'seller']);
  const id = Number((await params).id);
  const { action } = schema.parse(await req.json());

  const [o] = await query<{ buyer_id: number; seller_id: number; status: string }>(
    'SELECT buyer_id, seller_id, status FROM orders WHERE order_id = $1',
    [id],
  );
  if (!o) throw new HttpError(404, 'Order not found');

  if (action === 'deliver') {
    if (o.seller_id !== s.id) throw new HttpError(403, 'Only the seller can mark an order delivered');
    if (o.status !== 'placed') throw new HttpError(409, `Order is already ${o.status}`);
    await query(`CALL set_order_status($1, 'delivered')`, [id]);
  } else if (action === 'return') {
    if (o.buyer_id !== s.id) throw new HttpError(403, 'Only the buyer can return an order');
    if (o.status !== 'delivered') throw new HttpError(409, 'Only delivered orders can be returned');
    await query(`CALL set_order_status($1, 'returned')`, [id]);
  }
  return ok({ ok: true });
});
