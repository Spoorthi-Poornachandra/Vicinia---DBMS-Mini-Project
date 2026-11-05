import { z } from 'zod';
import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { cypher } from '@/lib/neo';
import { requireUser, HttpError } from '@/lib/auth';
import { pushTrustToPostgres } from '@/lib/graph';

const schema = z.object({ userId: z.number().int().positive(), weight: z.number().int().min(1).max(5).default(4) });

// POST /api/trust  — "I trust this user" (creates/updates a TRUSTS edge in Neo4j, then refreshes graph scores)
export const POST = route(async (req) => {
  const s = await requireUser(['buyer', 'seller']);
  const b = schema.parse(await req.json());
  if (b.userId === s.id) throw new HttpError(400, 'You cannot trust yourself');
  const exists = await query('SELECT 1 FROM users WHERE user_id = $1', [b.userId]);
  if (!exists.length) throw new HttpError(404, 'User not found');

  await cypher(
    `MERGE (a:User {id: $me}) ON CREATE SET a.flagged = false, a.trustScore = 0
     MERGE (t:User {id: $other}) ON CREATE SET t.flagged = false, t.trustScore = 0
     MERGE (a)-[r:TRUSTS]->(t) SET r.weight = $weight, r.since = date()`,
    { me: s.id, other: b.userId, weight: b.weight },
  );
  await pushTrustToPostgres();
  return ok({ ok: true });
});
