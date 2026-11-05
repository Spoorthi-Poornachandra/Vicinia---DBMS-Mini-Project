// =====================================================================
// Vicinia :: Cypher queries used by the app (parameters prefixed with $)
// =====================================================================

// ---- 1. Personalised trust: how much does $viewer trust $seller through the network? ----
// Paths up to 3 hops; each hop multiplies weight/5 and halves per extra hop (decay).
MATCH p = (v:User {id: $viewer})-[:TRUSTS*1..3]->(s:User {id: $seller})
WHERE all(n IN nodes(p) WHERE coalesce(n.flagged, false) = false)
WITH p, reduce(w = 1.0, r IN relationships(p) | w * r.weight / 5.0) * (0.5 ^ (length(p) - 1)) AS pathTrust
RETURN round(100 * (1 - exp(-sum(pathTrust))), 1) AS trust, count(p) AS paths;   // 0..100, saturating

// ---- 2. Global trust boost per seller (pushed to PostgreSQL seller_metrics.trust_boost) ----
// Each incoming TRUSTS counts more if the truster is itself trusted (has incoming trust); flagged users carry no weight.
MATCH (t:User)-[r:TRUSTS]->(s:User {role: 'seller'})
WHERE coalesce(t.flagged, false) = false
WITH s, sum(r.weight / 5.0 * (1 + size([(x:User)-[:TRUSTS]->(t) WHERE coalesce(x.flagged, false) = false | x]))) AS raw
SET s.trustScore = round(100 * raw / (raw + 2), 1)
RETURN s.id AS sellerId, s.trustScore AS trust;

// ---- 3. Collusion-ring detection ----
// A ring = a closed buying cycle among sellers (A->B->C->A, length 2..4) whose members
// receive (almost) NO purchases from users outside the cycle.
MATCH p = (a:User)-[:BOUGHT_FROM*2..4]->(a)
WHERE all(n IN nodes(p)[0..-1] WHERE n.role = 'seller')
WITH DISTINCT [n IN nodes(p)[0..-1] | n] AS members
WITH members, apoc.coll.sort([m IN members | m.id]) AS key
WITH DISTINCT key AS ids, members
UNWIND members AS m
OPTIONAL MATCH (x:User)-[:BOUGHT_FROM]->(m) WHERE NOT x IN members
WITH ids, members, count(DISTINCT x) AS outsideBuyers
WHERE outsideBuyers = 0
RETURN ids AS ringMembers, size(members) AS size, outsideBuyers;

// Plain-Cypher variant of the 3-cycle check (no APOC needed):
MATCH (a:User)-[:BOUGHT_FROM]->(b:User)-[:BOUGHT_FROM]->(c:User)-[:BOUGHT_FROM]->(a)
WHERE a.id < b.id AND a.id < c.id
WITH [a, b, c] AS ring
WHERE NOT EXISTS {
  MATCH (x:User)-[:BOUGHT_FROM]->(m:User) WHERE m IN ring AND NOT x IN ring
}
RETURN [m IN ring | m.id] AS ringMembers;

// ---- 4. Flag / unflag users in a detected ring ----
MATCH (a:User)-[:BOUGHT_FROM]->(b:User)-[:BOUGHT_FROM]->(c:User)-[:BOUGHT_FROM]->(a)
WHERE a.id < b.id AND a.id < c.id
WITH [a, b, c] AS ring
WHERE NOT EXISTS { MATCH (x:User)-[:BOUGHT_FROM]->(m:User) WHERE m IN ring AND NOT x IN ring }
UNWIND ring AS m
SET m.flagged = true
RETURN collect(DISTINCT m.id) AS flaggedIds;

// ---- 5. Suspicious reciprocal 5-star reviews (A reviews B 5 and B reviews A 5) ----
MATCH (a:User)-[r1:REVIEWED]->(b:User)-[r2:REVIEWED]->(a)
WHERE a.id < b.id AND r1.rating >= 4 AND r2.rating >= 4
RETURN a.id AS a, b.id AS b, count(*) AS pairs;

// ---- 6. "People like you also bought from" (seller recommendations) ----
MATCH (me:User {id: $userId})-[:BOUGHT_FROM]->(s:User)<-[:BOUGHT_FROM]-(other:User)-[:BOUGHT_FROM]->(rec:User)
WHERE rec <> me AND NOT (me)-[:BOUGHT_FROM]->(rec) AND coalesce(rec.flagged, false) = false
RETURN rec.id AS sellerId, rec.name AS name, count(DISTINCT other) AS supporters
ORDER BY supporters DESC LIMIT 5;

// ---- 7. Sync on order completion (called from the API after Postgres commit) ----
MERGE (b:User {id: $buyerId}) MERGE (s:User {id: $sellerId})
MERGE (b)-[r:BOUGHT_FROM {orderId: $orderId}]->(s) SET r.amount = $amount, r.at = datetime();
