// Runs db/neo4j/01_schema_seed.cypher against the Neo4j instance in .env
// Usage: npm run db:seed-neo4j
import fs from 'node:fs';
import path from 'node:path';
import neo4j from 'neo4j-driver';

const file = path.join(process.cwd(), 'db', 'neo4j', '01_schema_seed.cypher');
const text = fs.readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))   // drop comment-only lines
  .join('\n');
const statements = text.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

const driver = neo4j.driver(
  process.env.NEO4J_URI ?? 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? ''),
);
const session = driver.session();
try {
  for (const [i, s] of statements.entries()) {
    await session.run(s);
    console.log(`ok ${i + 1}/${statements.length}`);
  }
  console.log('Neo4j seeded.');
} finally {
  await session.close();
  await driver.close();
}
