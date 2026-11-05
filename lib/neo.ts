import neo4j, { Driver, Integer } from 'neo4j-driver';

const g = globalThis as unknown as { __vicinia_neo?: Driver };

function create(): Driver {
  return neo4j.driver(
    process.env.NEO4J_URI ?? 'bolt://localhost:7687',
    neo4j.auth.basic(process.env.NEO4J_USER ?? 'neo4j', process.env.NEO4J_PASSWORD ?? ''),
  );
}

export const driver: Driver = g.__vicinia_neo ?? (g.__vicinia_neo = create());

/** Convert neo4j Integers to JS numbers recursively. */
function plain(v: any): any {
  if (neo4j.isInt(v)) return (v as Integer).toNumber();
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
  }
  return v;
}

/** JS numbers are sent as Cypher floats by default; ids/weights are stored as integers, so convert whole numbers. */
function toNeo(v: any): any {
  if (typeof v === 'number' && Number.isInteger(v)) return neo4j.int(v);
  if (Array.isArray(v)) return v.map(toNeo);
  if (v && typeof v === 'object' && !neo4j.isInt(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toNeo(x)]));
  return v;
}

export async function cypher<T = Record<string, any>>(text: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const session = driver.session();
  try {
    const res = await session.run(text, toNeo(params));
    return res.records.map((r) => plain(r.toObject()) as T);
  } finally {
    await session.close();
  }
}
