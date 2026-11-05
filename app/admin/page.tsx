'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, inr } from '@/lib/client';

export default function Admin() {
  const [d, setD] = useState<any>(null);
  const [rings, setRings] = useState<{ members: number[] }[] | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setD(await api('/api/admin/overview')); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function detect() {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await api<{ rings: { members: number[] }[]; flaggedIds: number[] }>('/api/admin/detect', { method: 'POST' });
      setRings(r.rings);
      setMsg(r.rings.length ? `Found ${r.rings.length} collusion ring(s); ${r.flaggedIds.length} seller(s) flagged and their scores recomputed.` : 'No collusion rings found.');
      await load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }
  async function takedown(sellerId: number) {
    setError(''); setMsg('');
    try { const r = await api<{ removed: number }>('/api/admin/moderate', { method: 'POST', json: { sellerId } }); setMsg(`Removed ${r.removed} active listing(s).`); }
    catch (e: any) { setError(e.message); }
  }

  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Admin dashboard</h1>
      {error && <div className="err">{error}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      <div className="grid g4">
        <div className="card"><div className="small muted">Users</div><div className="stat">{d.stats.users}</div></div>
        <div className="card"><div className="small muted">Active listings</div><div className="stat">{d.stats.active_listings}</div></div>
        <div className="card"><div className="small muted">Orders</div><div className="stat">{d.stats.orders}</div></div>
        <div className="card"><div className="small muted">Gross sales</div><div className="stat">{inr(d.stats.gmv)}</div></div>
      </div>

      <div className="row between"><h2>Fraud detection (graph)</h2>
        <button onClick={detect} disabled={busy}>{busy ? 'Scanning…' : 'Run collusion scan'}</button></div>
      <p className="small muted">Looks for closed buying cycles among sellers who receive no purchases from outside the cycle. Flagged sellers lose network-trust weight and are ranked lower.</p>
      {rings && rings.map((r, i) => <div key={i} className="card">Ring {i + 1}: sellers {r.members.join(' ↔ ')}</div>)}

      <h3 style={{ marginTop: 16 }}>Flagged sellers</h3>
      <div className="card"><table>
        <thead><tr><th>ID</th><th>Name</th><th>Score</th><th></th></tr></thead>
        <tbody>
          {d.flagged.map((s: any) => (
            <tr key={s.user_id}><td>{s.user_id}</td><td>{s.name}</td><td>{Math.round(s.seller_score)}</td>
              <td><button className="danger" onClick={() => takedown(s.user_id)}>Remove their listings</button></td></tr>
          ))}
          {!d.flagged.length && <tr><td colSpan={4} className="muted">No flagged sellers.</td></tr>}
        </tbody></table></div>

      <h2>Seller leaderboard</h2>
      <div className="card"><table>
        <thead><tr><th>Seller</th><th>Score</th><th>Rating</th><th>Reviews</th><th>Orders</th><th>Return %</th><th>Reply (min)</th><th></th></tr></thead>
        <tbody>
          {d.leaderboard.map((s: any) => (
            <tr key={s.user_id}><td>{s.name}</td><td><b>{Math.round(s.seller_score)}</b></td><td>{Number(s.avg_rating).toFixed(1)}</td>
              <td>{s.review_count}</td><td>{s.orders_total}</td><td>{s.return_rate_pct}</td><td>{Math.round(s.avg_response_mins)}</td>
              <td>{s.is_flagged && <span className="badge bad">flagged</span>}</td></tr>
          ))}
        </tbody></table></div>

      <h2>Listings by category</h2>
      <div className="card"><table>
        <thead><tr><th>Category</th><th>Listings</th><th>Sold</th><th>Avg price</th></tr></thead>
        <tbody>{d.byCategory.map((c: any) => <tr key={c.category}><td>{c.category}</td><td>{c.listings}</td><td>{c.sold}</td><td>{inr(c.avg_price)}</td></tr>)}</tbody></table></div>
    </>
  );
}
