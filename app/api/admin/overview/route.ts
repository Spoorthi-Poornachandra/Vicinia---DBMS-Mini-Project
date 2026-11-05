import { route, ok } from '@/lib/http';
import { query } from '@/lib/pg';
import { requireUser } from '@/lib/auth';

export const GET = route(async () => {
  await requireUser(['admin']);
  const leaderboard = await query('SELECT * FROM v_seller_leaderboard');
  const flagged = await query(
    `SELECT u.user_id, u.name, m.seller_score, m.trust_boost
     FROM seller_metrics m JOIN users u ON u.user_id = m.seller_id WHERE m.is_flagged`,
  );
  const stats = (await query(
    `SELECT (SELECT count(*) FROM users) AS users,
            (SELECT count(*) FROM listings WHERE status = 'active') AS active_listings,
            (SELECT count(*) FROM orders) AS orders,
            (SELECT COALESCE(sum(total_amount),0) FROM orders WHERE status <> 'cancelled') AS gmv`,
  ))[0];
  const byCategory = await query(
    `SELECT c.name AS category, count(*) AS listings, round(avg(l.price),0) AS avg_price,
            count(*) FILTER (WHERE l.status = 'sold') AS sold
     FROM listings l JOIN categories c ON c.category_id = l.category_id
     GROUP BY c.name HAVING count(*) >= 1 ORDER BY listings DESC`,
  );
  return ok({ leaderboard, flagged, stats, byCategory });
});
