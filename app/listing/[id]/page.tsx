'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api, inr, Me } from '@/lib/client';

export default function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [d, setD] = useState<any>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [newPrice, setNewPrice] = useState('');

  const load = useCallback(async () => {
    try { setD(await api(`/api/listings/${id}`)); } catch (e: any) { setError(e.message); }
  }, [id]);

  useEffect(() => {
    load();
    api<{ user: Me | null }>('/api/auth/me').then((r) => setMe(r.user));
  }, [load]);

  async function buy() {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await api<{ orderId: number }>('/api/orders', { method: 'POST', json: { listingId: Number(id) } });
      setMsg(`Order #${r.orderId} placed. The seller will deliver within the estimated time.`);
      await load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  async function trust() {
    setError(''); setMsg('');
    try { await api('/api/trust', { method: 'POST', json: { userId: d.listing.seller_id, weight: 5 } }); setMsg('You now trust this seller. Their network trust score has been updated.'); await load(); }
    catch (e: any) { setError(e.message); }
  }

  async function reprice() {
    setError(''); setMsg('');
    try { await api(`/api/listings/${id}`, { method: 'PATCH', json: { price: Number(newPrice) } }); setMsg('Price updated.'); setNewPrice(''); await load(); }
    catch (e: any) { setError(e.message); }
  }

  if (!d) return error ? <div className="err">{error}</div> : <p className="muted">Loading…</p>;
  const { listing: l, reviews, delivery, trust: t, hint } = d;
  const isOwner = me?.id === l.seller_id;
  const canBuy = me && me.role !== 'admin' && !isOwner && l.status === 'active';

  return (
    <>
      <div className="row between">
        <h1>{l.title}</h1><span className="price" style={{ fontSize: 24 }}>{inr(l.price)}</span>
      </div>
      <p className="muted">{l.category} · {l.condition.replace('_', ' ')} · <span className={'badge' + (l.status !== 'active' ? ' warn' : '')}>{l.status}</span></p>
      {error && <div className="err">{error}</div>}
      {msg && <div className="okmsg">{msg}</div>}

      <div className="grid g2">
        <div className="card">
          <h3>About this item</h3>
          <p>{l.description || 'No description.'}</p>
          {canBuy && <button onClick={buy} disabled={busy}>{busy ? 'Placing order…' : `Buy now · ${inr(l.price)}`}</button>}
          {!me && <p className="small muted"><a href="/login">Log in</a> to buy.</p>}
          {l.status === 'sold' && <p className="small muted">This item has been sold.</p>}
          {delivery && (
            <p className="small" style={{ marginTop: 12 }}>
              Delivery to you: <b>{delivery.zone_name}</b> zone · {delivery.distance_km} km · est. <b>{delivery.est_hours} h</b>
            </p>
          )}
        </div>

        <div className="card">
          <div className="row between"><h3>Seller: {l.seller_name}</h3>
            {l.seller_flagged && <span className="badge bad">flagged for review</span>}</div>
          <div className="stat">{Math.round(l.seller_score)}<span className="small muted"> / 100 trust score</span></div>
          <div className="bar"><i style={{ width: `${l.seller_score}%` }} /></div>
          <p className="small muted" style={{ marginTop: 8 }}>
            ★ {Number(l.avg_rating).toFixed(1)} from {l.review_count ?? 0} review(s) · {l.orders_total ?? 0} orders ·
            {' '}{l.orders_total ? Math.round(100 * l.orders_returned / l.orders_total) : 0}% returned ·
            {' '}{l.avg_response_mins ? `replies in ~${Math.round(l.avg_response_mins)} min` : 'no response data yet'}
          </p>
          {t && (
            <p className="small"><b>Your network:</b> {t.paths > 0
              ? `${t.trust}% trust through ${t.paths} connection path(s) of people you trust`
              : 'no one in your trust network vouches for this seller yet'}</p>
          )}
          {me && me.role !== 'admin' && !isOwner && <button className="ghost" onClick={trust}>I trust this seller</button>}
        </div>
      </div>

      {isOwner && hint && (
        <div className="card" style={{ marginTop: 12 }}>
          <h3>Pricing hint</h3>
          <p>{hint.hint}. Demand {hint.demand} vs supply {hint.supply} nearby (ratio {hint.demand_supply_ratio}); suggested <b>{inr(hint.suggested_price)}</b>.</p>
          {l.status === 'active' && (
            <div className="row"><input style={{ maxWidth: 160 }} type="number" min="1" placeholder="New price" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
              <button onClick={reprice} disabled={!newPrice}>Update price</button></div>
          )}
        </div>
      )}

      <h2>Recent reviews of this seller</h2>
      {reviews.length === 0 && <p className="muted">No reviews yet.</p>}
      <div className="grid">
        {reviews.map((r: any, i: number) => (
          <div key={i} className="card"><b>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</b> <span className="small muted">by {r.reviewer}</span>
            {r.comment && <div>{r.comment}</div>}</div>
        ))}
      </div>
    </>
  );
}
