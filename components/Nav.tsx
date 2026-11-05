'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Me } from '@/lib/client';

export default function Nav() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api<{ user: Me | null }>('/api/auth/me').then((r) => setMe(r.user)).catch(() => setMe(null));
  }, []);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }

  return (
    <nav>
      <div className="in">
        <Link href="/" className="logo">Vicinia</Link>
        <Link href="/">Browse nearby</Link>
        {me && me.role !== 'admin' && <Link href="/orders">My orders</Link>}
        {me?.role === 'seller' && <Link href="/sell">Sell</Link>}
        {me?.role === 'admin' && <Link href="/admin">Admin</Link>}
        <span className="sp" />
        {me ? (
          <>
            <span className="small muted">{me.name} <span className="badge">{me.role}</span></span>
            <button className="ghost" onClick={logout}>Log out</button>
          </>
        ) : (
          <>
            <Link href="/login">Log in</Link>
            <Link href="/register">Sign up</Link>
          </>
        )}
      </div>
    </nav>
  );
}
