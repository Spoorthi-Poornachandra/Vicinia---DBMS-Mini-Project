// =====================================================================
// Vicinia :: Neo4j graph model (trust & collusion detection)
//
// Nodes
//   (:User {id, name, role, trustScore, flagged})        id mirrors users.user_id in PostgreSQL
// Relationships
//   (:User)-[:TRUSTS {weight, since}]->(:User)           explicit trust (1..5)
//   (:User)-[:BOUGHT_FROM {orderId, amount, at}]->(:User) one edge per completed order
//   (:User)-[:REVIEWED {orderId, rating, at}]->(:User)    reviewer -> seller
// =====================================================================

// ---- Constraints & indexes ----
CREATE CONSTRAINT user_id_unique IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE;
CREATE INDEX user_flagged IF NOT EXISTS FOR (u:User) ON (u.flagged);
CREATE INDEX bought_order IF NOT EXISTS FOR ()-[b:BOUGHT_FROM]-() ON (b.orderId);

// ---- Seed (mirrors Postgres seed) ----
UNWIND [
  {id:1,name:'Asha Admin',role:'admin'},   {id:2,name:'Ravi Buyer',role:'buyer'},
  {id:3,name:'Meera Buyer',role:'buyer'},  {id:4,name:'Karthik Buyer',role:'buyer'},
  {id:5,name:'Suresh Seller',role:'seller'},{id:6,name:'Divya Seller',role:'seller'},
  {id:7,name:'Imran Seller',role:'seller'}, {id:8,name:'Ring Alpha',role:'seller'},
  {id:9,name:'Ring Beta',role:'seller'},    {id:10,name:'Ring Gamma',role:'seller'}
] AS row
MERGE (u:User {id: row.id}) SET u.name = row.name, u.role = row.role, u.trustScore = 0, u.flagged = false;

// Explicit trust edges (community members vouching for each other)
UNWIND [
  [2,5,5],[2,6,4],[3,6,5],[3,5,4],[4,6,4],[5,6,5],[6,5,4],[6,7,3],[5,7,3],[3,2,4],[2,3,4],
  [8,9,5],[9,10,5],[10,8,5]               // ring members only trust each other
] AS t
MATCH (a:User {id:t[0]}), (b:User {id:t[1]})
MERGE (a)-[r:TRUSTS]->(b) SET r.weight = t[2], r.since = date();

// Purchase + review edges (same orders as Postgres seed)
UNWIND [
  {o:1,buyer:2,seller:6,amt:9000,rating:5},  {o:2,buyer:3,seller:5,amt:9000,rating:4},
  {o:3,buyer:4,seller:7,amt:11000,rating:null},
  {o:4,buyer:9,seller:8,amt:300,rating:5},   {o:5,buyer:9,seller:8,amt:250,rating:5},
  {o:6,buyer:10,seller:9,amt:200,rating:5},  {o:7,buyer:10,seller:9,amt:350,rating:5},
  {o:8,buyer:8,seller:10,amt:150,rating:5},  {o:9,buyer:8,seller:10,amt:600,rating:5}
] AS x
MATCH (b:User {id:x.buyer}), (s:User {id:x.seller})
MERGE (b)-[bf:BOUGHT_FROM {orderId:x.o}]->(s) SET bf.amount = x.amt, bf.at = datetime()
FOREACH (_ IN CASE WHEN x.rating IS NULL THEN [] ELSE [1] END |
  MERGE (b)-[rv:REVIEWED {orderId:x.o}]->(s) SET rv.rating = x.rating, rv.at = datetime());
