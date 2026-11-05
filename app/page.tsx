'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, DEFAULT_LOCATION, inr, km, Me } from '@/lib/client';

interface Row {
  listing_id: number; title: string; price: number; category: string; condition: string;
  seller_id: number; seller_name: string; seller_score: number; avg_rating: number; seller_flagged: boolean;
  distance_m: number; rank_score: number;
}
interface Cat { category_id: number; name: string }

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [loc, setLoc] = useState(DEFAULT_LOCATION);
  const [cats, setCats] = useState<Cat[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [recs, setRecs] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({ q: '', radiusKm: '5', category: '', minPrice: '', maxPrice: '', minRating: '', sort: 'rank' });
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });

  const search = useCallback(async (l = loc) => {
    setLoading(true); setError('');
    const p = new URLSearchParams({ lat: String(l.lat), lon: String(l.lon) });
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    try { setRows(await api<Row[]>('/api/listings?' + p)); }
    catch (e: any) { setError(e.message); }
    setLoading(false);
  }, [f, loc]);

  useEffect(() => {
    api<Cat[]>('/api/categories').then(setCats).catch(() => {});
    api<{ user: Me | null }>('/api/auth/me').then((r) => {
      if (r.user) {
        setMe(r.user); setLoc({ lat: r.user.lat, lon: r.user.lon });
        search({ lat: r.user.lat, lon: r.user.lon });
        if (r.user.role !== 'admin') api('/api/recommendations').then(setRecs).catch(() => {});
      } else search();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function locate() {
    navigator.geolocation?.getCurrentPosition((p) => {
      const l = { lat: p.coords.latitude, lon: p.coords.longitude };
      setLoc(l); search(l);
    });
  }

  return (
    <>
      <h1>Find it nearby</h1>
      <p className="muted">Searching around {loc.lat.toFixed(4)}, {loc.lon.toFixed(4)}{me ? ' (your saved location)' : ''}. Results are ranked by seller trust and distance.</p>

      <form className="card grid g4" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <div><label>Search</label><input value={f.q} onChange={set('q')} placeholder="couch, laptop…" /></div>
        <div><label>Radius (km)</label><input type="number" min="0.5" max="50" step="0.5" value={f.radiusKm} onChange={set('radiusKm')} /></div>
        <div><label>Category</label>
          <select value={f.category} onChange={set('category')}><option value="">All</option>
            {cats.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</select></div>
        <div><label>Sort by</label>
          <select value={f.sort} onChange={set('sort')}>
            <option value="rank">Best match (trust + distance)</option><option value="distance">Nearest</option>
            <option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></div>
        <div><label>Min price</label><input type="number" min="0" value={f.minPrice} onChange={set('minPrice')} /></div>
        <div><label>Max price</label><input type="number" min="0" value={f.maxPrice} onChange={set('maxPrice')} /></div>
        <div><label>Min seller rating</label><input type="number" min="0" max="5" step="0.5" value={f.minRating} onChange={set('minRating')} /></div>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <button>Search</button><button type="button" className="ghost" onClick={locate}>Use my location</button>
        </div>
      </form>

      {error && <div className="err">{error}</div>}
      <h2>{loading ? 'Searching…' : `${rows.length} listing${rows.length === 1 ? '' : 's'} nearby`}</h2>
      <div className="grid g2">
        {rows.map((r) => (
          <Link key={r.listing_id} href={`/listing/${r.listing_id}`} className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="row between"><h3>{r.title}</h3><span className="price">{inr(r.price)}</span></div>
            <div className="small muted">{r.category} · {r.condition.replace('_', ' ')} · {km(r.distance_m)} away</div>
            <div className="row between" style={{ marginTop: 8 }}>
              <span className="small">{r.seller_name}</span>
              <span>
                {r.seller_flagged && <span className="badge bad">flagged</span>}{' '}
                <span className={'badge' + (r.seller_score < 40 ? ' warn' : '')}>trust {Math.round(r.seller_score)}/100</span>
              </span>
            </div>
            <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${Math.max(0, Math.min(100, r.seller_score))}%` }} /></div>
          </Link>
        ))}
      </div>
      {!loading && !rows.length && !error && <p className="muted">Nothing within that radius. Try widening it.</p>}

      {recs?.sellers?.length > 0 && (
        <>
          <h2>Buyers like you also bought from</h2>
          <div className="grid g2">
            {recs.listings.map((l: any) => (
              <Link key={l.listing_id} href={`/listing/${l.listing_id}`} className="card" style={{ color: 'inherit' }}>
                <div className="row between"><h3>{l.title}</h3><span className="price">{inr(l.price)}</span></div>
                <div className="small muted">{l.seller_name} · trust {Math.round(l.seller_score)}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
