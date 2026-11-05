export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Request failed');
  return data as T;
}

export interface Me {
  id: number;
  name: string;
  role: 'buyer' | 'seller' | 'admin';
  lat: number;
  lon: number;
}

export const DEFAULT_LOCATION = { lat: 12.9784, lon: 77.6408 }; // Indiranagar, Bengaluru

export const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN');
export const km = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
