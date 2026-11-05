import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { cypher } from '@/lib/neo';
import { requireUser } from '@/lib/auth';

// Graph recommendation: sellers bought from by people who bought from the same sellers as me.
export const GET = route(async () => {
  const s = await requireUser(['buyer', 'seller']);
  const recs = await cypher<{ sellerId: number; supporters: number }>(
    `MATCH (me:User {id: $userId})-[:BOUGHT_FROM]->(:User)<-[:BOUGHT_FROM]-(other:User)-[:BOUGHT_FROM]->(rec:User)
     WHERE rec.id <> $userId AND NOT (me)-[:BOUGHT_FROM]->(rec) AND coalesce(rec.flagged, false) = false
     RETURN rec.id AS sellerId, count(DISTINCT other) AS supporters
     ORDER BY supporters DESC LIMIT 5`,
    { userId: s.id },
  );
  const ids = recs.map((r) => r.sellerId);
  const listings = ids.length
    ? await query(
        `SELECT v.listing_id, v.title, v.price, v.seller_name, v.seller_score
         FROM v_listing_search v WHERE v.status = 'active' AND v.seller_id = ANY($1::bigint[])
         ORDER BY v.seller_score DESC LIMIT 6`,
        [ids],
      )
    : [];
  return ok({ sellers: recs, listings });
});
