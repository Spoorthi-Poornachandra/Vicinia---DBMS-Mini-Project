'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, inr } from '@/lib/client';

export default function Sell() {
  const [d, setD] = useState<any>(null);
  const [cats, setCats] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [f, setF] = useState({ title: '', description: '', price: '', categoryId: '', condition: 'used' });
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });

  const load = useCallback(async () => {
    try { setD(await api('/api/seller/dashboard')); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); api('/api/categories').then(setCats).catch(() => {}); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setError(''); setMsg('');
    try {
      await api('/api/listings', { method: 'POST', json: { ...f, price: Number(f.price), categoryId: Number(f.categoryId) } });
      setMsg('Listing published at your saved location.');
      setF({ title: '', description: '', price: '', categoryId: '', condition: 'used' });
      await load();
    } catch (e: any) { setError(e.message); }
  }
  async function remove(id: number) {
    setError('');
    try { await api(`/api/listings/${id}`, { method: 'PATCH', json: { status: 'removed' } }); await load(); } catch (e: any) { setError(e.message); }
  }
  async function deliver(id: number) {
    setError('');
    try { await api(`/api/orders/${id}`, { method: 'PATCH', json: { action: 'deliver' } }); await load(); } catch (e: any) { setError(e.message); }
  }

  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Loading…</p>;
  const m = d.metrics;

  return (
    <>
      <h1>Seller dashboard</h1>
      {error && <div className="err">{error}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      {m && (
        <div className="grid g4">
          <div className="card"><div className="small muted">Seller score</div><div className="stat">{Math.round(m.seller_score)}</div><div className="small muted">drives your search ranking</div></div>
          <div className="card"><div className="small muted">Avg rating</div><div className="stat">{Number(m.avg_rating).toFixed(1)}</div><div className="small muted">{m.review_count} reviews</div></div>
          <div className="card"><div className="small muted">Return rate</div><div className="stat">{m.orders_total ? Math.round(100 * m.orders_returned / m.orders_total) : 0}%</div><div className="small muted">{m.orders_total} orders</div></div>
          <div className="card"><div className="small muted">Network trust</div><div className="stat">{Math.round(m.trust_boost)}</div>{m.is_flagged && <span className="badge bad">flagged</span>}</div>
        </div>
      )}

      <h2>List an item</h2>
      <form className="card grid g2" onSubmit={create}>
        <div><label>Title</label><input value={f.title} onChange={set('title')} required minLength={3} /></div>
        <div><label>Price (₹)</label><input type="number" min="1" value={f.price} onChange={set('price')} required /></div>
        <div><label>Category</label>
          <select value={f.categoryId} onChange={set('categoryId')} required><option value="">Choose…</option>
            {cats.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</select></div>
        <div><label>Condition</label>
          <select value={f.condition} onChange={set('condition')}><option value="new">New</option><option value="like_new">Like new</option><option value="used">Used</option><option value="refurbished">Refurbished</option></select></div>
        <div style={{ gridColumn: '1 / -1' }}><label>Description</label><textarea rows={3} value={f.description} onChange={set('description')} /></div>
        <div><button>Publish</button></div>
      </form>

      <h2>Your listings</h2>
      <div className="card"><table>
        <thead><tr><th>Item</th><th>Price</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {d.listings.map((l: any) => (
            <tr key={l.listing_id}>
              <td><Link href={`/listing/${l.listing_id}`}>{l.title}</Link></td><td>{inr(l.price)}</td>
              <td><span className="badge">{l.status}</span></td>
              <td>{l.status === 'active' && <button className="ghost" onClick={() => remove(l.listing_id)}>Remove</button>}</td>
            </tr>
          ))}
        </tbody></table></div>

      <h2>Orders to fulfil</h2>
      <div className="card"><table>
        <thead><tr><th>#</th><th>Items</th><th>Buyer</th><th>Amount</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {d.orders.map((o: any) => (
            <tr key={o.order_id}><td>{o.order_id}</td><td>{o.items}</td><td>{o.buyer_name}</td><td>{inr(o.total_amount)}</td>
              <td><span className="badge">{o.status}</span></td>
              <td>{o.status === 'placed' && <button onClick={() => deliver(o.order_id)}>Mark delivered</button>}</td></tr>
          ))}
          {!d.orders.length && <tr><td colSpan={6} className="muted">No orders yet.</td></tr>}
        </tbody></table></div>
    </>
  );
}
