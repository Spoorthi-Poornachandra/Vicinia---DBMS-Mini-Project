import { z } from 'zod';
import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { cypher } from '@/lib/neo';
import { getSession, requireUser, userLocation, HttpError } from '@/lib/auth';

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Bad listing id');

  const rows = await query(
    `SELECT v.listing_id, v.title, v.description, v.price, v.condition, v.status, v.category,
            v.seller_id, v.seller_name, v.seller_score, v.avg_rating, v.seller_flagged,
            ST_Y(v.location::geometry) AS lat, ST_X(v.location::geometry) AS lon,
            m.review_count, m.orders_total, m.orders_returned, m.avg_response_mins
     FROM v_listing_search v LEFT JOIN seller_metrics m ON m.seller_id = v.seller_id
     WHERE v.listing_id = $1`,
    [id],
  );
  const listing = rows[0];
  if (!listing) throw new HttpError(404, 'Listing not found');

  const reviews = await query(
    `SELECT r.rating, r.comment, r.created_at, u.name AS reviewer
     FROM reviews r JOIN users u ON u.user_id = r.reviewer_id
     WHERE r.seller_id = $1 ORDER BY r.created_at DESC LIMIT 10`,
    [listing.seller_id],
  );

  const session = await getSession();
  let delivery = null, trust = null, hint = null;
  if (session) {
    const loc = await userLocation(session.id);
    const d = await query(
      'SELECT * FROM estimate_delivery($1, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography)',
      [id, loc.lon, loc.lat],
    );
    delivery = d[0] ?? null;
    if (session.id === listing.seller_id) {
      hint = (await query('SELECT * FROM pricing_hint($1)', [id]))[0] ?? null;
    } else {
      try {
        const t = await cypher<{ trust: number; paths: number }>(
          `MATCH p = (v:User {id: $viewer})-[:TRUSTS*1..3]->(s:User {id: $seller})
           WHERE all(n IN nodes(p) WHERE coalesce(n.flagged, false) = false)
           WITH p, reduce(w = 1.0, r IN relationships(p) | w * r.weight / 5.0) * (0.5 ^ (length(p) - 1)) AS pt
           RETURN round(100 * (1 - exp(-sum(pt))), 1) AS trust, count(p) AS paths`,
          { viewer: session.id, seller: listing.seller_id },
        );
        trust = t[0] ?? { trust: 0, paths: 0 };
      } catch {
        trust = null; // graph DB unavailable: degrade gracefully
      }
    }
  }
  return ok({ listing, reviews, delivery, trust, hint, viewerId: session?.id ?? null });
});

const patchSchema = z.object({
  price: z.number().positive().max(10_000_000).optional(),
  status: z.enum(['active', 'removed']).optional(),
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const s = await requireUser(['seller', 'admin']);
  const id = Number((await params).id);
  const b = patchSchema.parse(await req.json());
  const rows = await query(
    `UPDATE listings SET price = COALESCE($1, price), status = COALESCE($2::listing_status, status)
     WHERE listing_id = $3 AND ($4 = 'admin' OR seller_id = $5) AND status <> 'sold'
     RETURNING listing_id`,
    [b.price ?? null, b.status ?? null, id, s.role, s.id],
  );
  if (!rows.length) throw new HttpError(404, 'Listing not found, already sold, or not yours');
  return ok({ ok: true });
});
