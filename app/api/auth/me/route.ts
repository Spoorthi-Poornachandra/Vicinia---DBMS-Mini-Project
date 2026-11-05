import { route, ok } from '@/lib/http';
import { getSession, userLocation } from '@/lib/auth';

export const GET = route(async () => {
  const s = await getSession();
  if (!s) return ok({ user: null });
  const loc = await userLocation(s.id);
  return ok({ user: { ...s, ...loc } });
});
