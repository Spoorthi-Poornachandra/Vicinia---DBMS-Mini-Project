import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { createSession, HttpError } from '@/lib/auth';

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  const rows = await query<{ user_id: number; name: string; role: 'buyer' | 'seller' | 'admin'; password_hash: string }>(
    'SELECT user_id, name, role, password_hash FROM users WHERE email = $1',
    [b.email],
  );
  const u = rows[0];
  // same message for unknown email / wrong password: do not reveal which accounts exist
  if (!u || !(await bcrypt.compare(b.password, u.password_hash))) throw new HttpError(401, 'Invalid email or password');
  await createSession({ id: u.user_id, name: u.name, role: u.role });
  return ok({ id: u.user_id, name: u.name, role: u.role });
});
