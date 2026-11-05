import { cypher } from './neo';
import { query } from './pg';

/** Graph sync contract: called after a PostgreSQL order commit. Never throws (graph is derived data). */
export async function syncOrderToGraph(o: { orderId: number; buyerId: number; sellerId: number; amount: number }) {
  try {
    await cypher(
      `MERGE (b:User {id: $buyerId}) ON CREATE SET b.flagged = false, b.trustScore = 0
       MERGE (s:User {id: $sellerId}) ON CREATE SET s.flagged = false, s.trustScore = 0
       MERGE (b)-[r:BOUGHT_FROM {orderId: $orderId}]->(s)
       SET r.amount = $amount, r.at = datetime()`,
      o,
    );
    return true;
  } catch (e) {
    console.error('graph sync failed', e);
    return false;
  }
}

export async function syncReviewToGraph(r: { orderId: number; reviewerId: number; sellerId: number; rating: number }) {
  try {
    await cypher(
      `MATCH (b:User {id: $reviewerId}), (s:User {id: $sellerId})
       MERGE (b)-[rv:REVIEWED {orderId: $orderId}]->(s) SET rv.rating = $rating, rv.at = datetime()`,
      r,
    );
  } catch (e) {
    console.error('graph review sync failed', e);
  }
}

/** Recompute graph trust for every seller and push trust_boost + flagged into PostgreSQL. */
export async function pushTrustToPostgres() {
  const rows = await cypher<{ id: number; trust: number; flagged: boolean }>(
    `MATCH (s:User {role: 'seller'})
     OPTIONAL MATCH (t:User)-[r:TRUSTS]->(s) WHERE coalesce(t.flagged, false) = false
     WITH s, sum(CASE WHEN r IS NULL THEN 0
                      ELSE r.weight / 5.0 * (1 + size([(x:User)-[:TRUSTS]->(t) WHERE coalesce(x.flagged, false) = false | x])) END) AS raw
     SET s.trustScore = round(100 * raw / (raw + 2), 1)
     RETURN s.id AS id, s.trustScore AS trust, coalesce(s.flagged, false) AS flagged`,
  );
  for (const r of rows) {
    await query('SELECT apply_graph_signals($1, $2, $3)', [r.id, r.trust, r.flagged]);
  }
  return rows;
}

/**
 * Collusion detection: closed buying cycles (length 2-4) among sellers whose members
 * receive no purchases from anyone outside the cycle.
 */
export async function detectCollusionRings() {
  const cycles = await cypher<{ members: number[] }>(
    `MATCH p = (a:User)-[:BOUGHT_FROM*2..4]->(a)
     WHERE a.role = 'seller'
     RETURN DISTINCT [n IN nodes(p)[1..] | n.id] AS members`,
  );
  const seen = new Set<string>();
  const rings: { members: number[]; outsideBuyers: number }[] = [];
  for (const c of cycles) {
    const uniq = Array.from(new Set(c.members)).sort((a, b) => a - b);
    if (uniq.length !== c.members.length) continue; // must be a simple cycle
    const key = uniq.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const out = await cypher<{ outside: number }>(
      `MATCH (x:User)-[:BOUGHT_FROM]->(m:User) WHERE m.id IN $ids AND NOT x.id IN $ids
       RETURN count(DISTINCT x) AS outside`,
      { ids: uniq },
    );
    const outside = out[0]?.outside ?? 0;
    if (outside === 0) rings.push({ members: uniq, outsideBuyers: outside });
  }

  // Reset then flag ring members, then propagate to PostgreSQL
  await cypher(`MATCH (u:User) SET u.flagged = false`);
  const flaggedIds = Array.from(new Set(rings.flatMap((r) => r.members)));
  if (flaggedIds.length) await cypher(`MATCH (u:User) WHERE u.id IN $ids SET u.flagged = true`, { ids: flaggedIds });
  await pushTrustToPostgres();
  return { rings, flaggedIds };
}
