import { route, ok } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { detectCollusionRings } from '@/lib/graph';
import { query } from '@/lib/pg';

// Runs graph collusion detection, flags ring members, and pushes the result into PostgreSQL scores.
export const POST = route(async () => {
  await requireUser(['admin']);
  const result = await detectCollusionRings();
  await query('REFRESH MATERIALIZED VIEW mv_demand_by_cell');
  return ok(result);
});
