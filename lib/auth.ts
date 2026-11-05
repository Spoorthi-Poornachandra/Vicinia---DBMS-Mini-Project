import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { query } from './pg';

export type Role = 'buyer' | 'seller' | 'admin';
export interface Session {
  id: number;
  name: string;
  role: Role;
}

const COOKIE = 'vicinia_session';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new HttpError(500, 'JWT_SECRET is not configured');
  return new TextEncoder().encode(s);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function createSession(user: Session) {
  const token = await new SignJWT({ id: user.id, name: user.name, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: Number(payload.id), name: String(payload.name), role: payload.role as Role };
  } catch {
    return null;
  }
}

/** Role-based access control: throws 401/403 unless a logged-in user with an allowed role. */
export async function requireUser(roles?: Role[]): Promise<Session> {
  const s = await getSession();
  if (!s) throw new HttpError(401, 'Please log in');
  if (roles && !roles.includes(s.role)) throw new HttpError(403, 'Your role is not allowed to do this');
  return s;
}

export async function userLocation(id: number): Promise<{ lat: number; lon: number }> {
  const rows = await query<{ lat: number; lon: number }>(
    'SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM users WHERE user_id = $1',
    [id],
  );
  if (!rows[0]) throw new HttpError(404, 'User not found');
  return rows[0];
}
