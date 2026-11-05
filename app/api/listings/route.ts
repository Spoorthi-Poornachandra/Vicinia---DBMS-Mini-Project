import { z } from 'zod';
import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { requireUser } from '@/lib/auth';

const num = (d?: string) => (d === undefined || d === '' ? undefined : Number(d));

const schema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusKm: z.number().min(0.1).max(50).default(5),
  category: z.number().int().optional(),
  minPrice: z.number().min(0).optional(),
  maxPrice: z.number().min(0).optional(),
  minRating: z.number().min(0).max(5).optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['rank', 'distance', 'price_asc', 'price_desc']).default('rank'),
});

// GET /api/listings?lat=..&lon=..&radiusKm=5&category=&minPrice=&maxPrice=&minRating=&q=&sort=
export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  const p = schema.parse({
    lat: num(sp.get('lat') ?? undefined),
    lon: num(sp.get('lon') ?? undefined),
    radiusKm: num(sp.get('radiusKm') ?? undefined),
    category: num(sp.get('category') ?? undefined),
    minPrice: num(sp.get('minPrice') ?? undefined),
    maxPrice: num(sp.get('maxPrice') ?? undefined),
    minRating: num(sp.get('minRating') ?? undefined),
    q: sp.get('q') || undefined,
    sort: sp.get('sort') || undefined,
  });
  const rows = await query(
    'SELECT * FROM search_nearby($1,$2,$3,$4,$5,$6,$7,$8,$9,50)',
    [p.lat, p.lon, p.radiusKm * 1000, p.category ?? null, p.minPrice ?? null, p.maxPrice ?? null, p.minRating ?? null, p.q ?? null, p.sort],
  );
  return ok(rows);
});

const createSchema = z.object({
  title: z.string().trim().min(3).max(150),
  description: z.string().trim().max(2000).default(''),
  price: z.number().positive().max(10_000_000),
  categoryId: z.number().int(),
  condition: z.enum(['new', 'like_new', 'used', 'refurbished']).default('used'),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
});

export const POST = route(async (req) => {
  const s = await requireUser(['seller']);
  const b = createSchema.parse(await req.json());
  const rows = await query<{ listing_id: number }>(
    `INSERT INTO listings (seller_id, category_id, title, description, price, condition, location)
     VALUES ($1,$2,$3,$4,$5,$6,
        CASE WHEN $7::float8 IS NULL OR $8::float8 IS NULL
             THEN (SELECT location FROM users WHERE user_id = $1)
             ELSE ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography END)
     RETURNING listing_id`,
    [s.id, b.categoryId, b.title, b.description, b.price, b.condition, b.lat ?? null, b.lon ?? null],
  );
  return ok({ listingId: rows[0].listing_id }, 201);
});
