'use client';
import { useState } from 'react';
import { api } from '@/lib/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const u = await api<{ role: string }>('/api/auth/login', { method: 'POST', json: { email, password } });
      window.location.href = u.role === 'admin' ? '/admin' : u.role === 'seller' ? '/sell' : '/';
    } catch (err: any) { setError(err.message); setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 380, margin: '40px auto' }}>
      <h1>Log in</h1>
      <form className="card grid" onSubmit={submit}>
        <div><label>Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <div><label>Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
        {error && <div className="err">{error}</div>}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Log in'}</button>
        <p className="small muted">Demo accounts (password <code>password123</code>): admin@vicinia.test, ravi@vicinia.test (buyer), suresh@vicinia.test (seller)</p>
      </form>
    </div>
  );
}
