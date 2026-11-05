import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { createSession, HttpError } from '@/lib/auth';
import { cypher } from '@/lib/neo';

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  role: z.enum(['buyer', 'seller']), // admins cannot self-register
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});

export const POST = route(async (req) => {
  const b = schema.parse(await req.json());
  const exists = await query('SELECT 1 FROM users WHERE email = $1', [b.email]);
  if (exists.length) throw new HttpError(409, 'An account with this email already exists');

  const hash = await bcrypt.hash(b.password, 10); // never store plain-text passwords
  const rows = await query<{ user_id: number }>(
    `INSERT INTO users (name, email, password_hash, role, location)
     VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($5, $6), 4326)::geography)
     RETURNING user_id`,
    [b.name, b.email, hash, b.role, b.lon, b.lat],
  );
  const id = rows[0].user_id;
  try {
    await cypher(`MERGE (u:User {id: $id}) SET u.name = $name, u.role = $role, u.trustScore = coalesce(u.trustScore, 0), u.flagged = coalesce(u.flagged, false)`,
      { id, name: b.name, role: b.role });
  } catch (e) {
    console.error('graph user sync failed', e);
  }
  await createSession({ id, name: b.name, role: b.role });
  return ok({ id, name: b.name, role: b.role }, 201);
});
