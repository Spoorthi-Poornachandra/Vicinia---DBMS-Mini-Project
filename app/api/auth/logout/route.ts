import { route, ok } from '@/lib/http';
import { destroySession } from '@/lib/auth';

export const POST = route(async () => {
  await destroySession();
  return ok({ ok: true });
});
