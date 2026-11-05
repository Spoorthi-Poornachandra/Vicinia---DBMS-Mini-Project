import { Pool, PoolClient, types } from 'pg';

// numeric (1700) and bigint (20) come back as strings by default; the app wants numbers
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(20, (v) => parseInt(v, 10));

const g = globalThis as unknown as { __vicinia_pool?: Pool };

function createPool(): Pool {
  // All connection settings come from environment variables (see .env.example)
  return new Pool({
    host: process.env.PG_HOST,
    port: Number(process.env.PG_PORT ?? 5432),
    user: process.env.PG_USER,
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE,
    max: 10,
  });
}

export const pool: Pool = g.__vicinia_pool ?? (g.__vicinia_pool = createPool());

export async function query<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params as any[]);
  return res.rows as T[];
}

export type Isolation = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

/** Run fn inside a transaction with the requested isolation level. Rolls back on any error. */
export async function tx<T>(fn: (c: PoolClient) => Promise<T>, isolation: Isolation = 'READ COMMITTED'): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
