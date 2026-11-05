import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';

export const GET = route(async () => {
  return ok(await query('SELECT category_id, name, parent_id FROM categories ORDER BY name'));
});
