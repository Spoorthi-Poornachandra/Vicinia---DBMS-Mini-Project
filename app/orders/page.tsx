'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, inr } from '@/lib/client';

export default function Orders() {
  const [data, setData] = useState<{ me: number; orders: any[] } | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [rating, setRating] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try { setData(await api('/api/orders')); } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: number, action: 'deliver' | 'return') {
    setError(''); setMsg('');
    try { await api(`/api/orders/${id}`, { method: 'PATCH', json: { action } }); setMsg(`Order #${id} updated.`); await load(); }
    catch (e: any) { setError(e.message); }
  }
  async function review(id: number) {
    setError(''); setMsg('');
    try { await api('/api/reviews', { method: 'POST', json: { orderId: id, rating: Number(rating[id] ?? 5) } }); setMsg('Review submitted. The seller score has been recalculated.'); await load(); }
    catch (e: any) { setError(e.message); }
  }

  if (!data) return error ? <div className="err">{error} {error.includes('log in') && <a href="/login">Log in</a>}</div> : <p className="muted">Loading…</p>;

  return (
    <>
      <h1>My orders</h1>
      {error && <div className="err">{error}</div>}
      {msg && <div className="okmsg">{msg}</div>}
      <div className="card">
        <table>
          <thead><tr><th>#</th><th>Items</th><th>Role</th><th>With</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {data.orders.map((o) => {
              const asBuyer = o.buyer_id === data.me;
              return (
                <tr key={o.order_id}>
                  <td>{o.order_id}</td><td>{o.items}</td><td>{asBuyer ? 'Buyer' : 'Seller'}</td>
                  <td>{asBuyer ? o.seller_name : o.buyer_name}</td><td>{inr(o.total_amount)}</td>
                  <td><span className={'badge' + (o.status === 'returned' ? ' warn' : '')}>{o.status}</span></td>
                  <td className="row">
                    {!asBuyer && o.status === 'placed' && <button onClick={() => act(o.order_id, 'deliver')}>Mark delivered</button>}
                    {asBuyer && o.status === 'delivered' && (
                      <>
                        <button className="danger" onClick={() => act(o.order_id, 'return')}>Return</button>
                        {!o.reviewed && (
                          <>
                            <select style={{ width: 70 }} value={rating[o.order_id] ?? '5'} onChange={(e) => setRating({ ...rating, [o.order_id]: e.target.value })}>
                              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}★</option>)}
                            </select>
                            <button className="ghost" onClick={() => review(o.order_id)}>Review</button>
                          </>
                        )}
                        {o.reviewed && <span className="small muted">reviewed</span>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!data.orders.length && <tr><td colSpan={7} className="muted">No orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
