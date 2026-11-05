'use client';
import { useState } from 'react';
import { api, DEFAULT_LOCATION } from '@/lib/client';

export default function Register() {
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'buyer', lat: String(DEFAULT_LOCATION.lat), lon: String(DEFAULT_LOCATION.lon) });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<any>) => setF({ ...f, [k]: e.target.value });

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition((p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(5), lon: p.coords.longitude.toFixed(5) })));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/api/auth/register', { method: 'POST', json: { ...f, lat: Number(f.lat), lon: Number(f.lon) } });
      window.location.href = f.role === 'seller' ? '/sell' : '/';
    } catch (err: any) { setError(err.message); setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 420, margin: '30px auto' }}>
      <h1>Create account</h1>
      <form className="card grid" onSubmit={submit}>
        <div><label>Name</label><input value={f.name} onChange={set('name')} required minLength={2} /></div>
        <div><label>Email</label><input type="email" value={f.email} onChange={set('email')} required /></div>
        <div><label>Password (min 8 characters)</label><input type="password" value={f.password} onChange={set('password')} required minLength={8} /></div>
        <div><label>I want to</label>
          <select value={f.role} onChange={set('role')}><option value="buyer">Buy</option><option value="seller">Sell (and buy)</option></select></div>
        <div className="row">
          <div style={{ flex: 1 }}><label>Latitude</label><input value={f.lat} onChange={set('lat')} required /></div>
          <div style={{ flex: 1 }}><label>Longitude</label><input value={f.lon} onChange={set('lon')} required /></div>
        </div>
        <button type="button" className="ghost" onClick={useMyLocation}>Use my current location</button>
        {error && <div className="err">{error}</div>}
        <button disabled={busy}>{busy ? 'Creating…' : 'Sign up'}</button>
      </form>
    </div>
  );
}
