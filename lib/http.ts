import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { HttpError } from './auth';

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a route handler so errors become clean JSON responses (never leak stack traces). */
export function route<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await fn(req, ctx);
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) {
        return NextResponse.json({ error: e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
      }
      // PostgreSQL errors raised by constraints/triggers/functions carry a useful, safe message
      if (e && typeof e.code === 'string' && e.code.length === 5) {
        // 23505 unique violation, P0001 raised by our functions, 40001 serialization failure (lost the race)
        const status = ['23505', 'P0001', '40001'].includes(e.code) ? 409 : 400;
        const msg = e.code === '23505' ? 'That record already exists or the item was already sold' : e.message;
        return NextResponse.json({ error: msg, code: e.code }, { status });
      }
      console.error(e);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
