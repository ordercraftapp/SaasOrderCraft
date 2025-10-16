// src/lib/auth/refreshRole.ts
import { getAuth } from 'firebase/auth';

export type RefreshRoleResp = {
  ok: boolean;
  tenantId?: string;
  role?: 'admin' | 'kitchen' | 'waiter' | 'delivery' | 'cashier' | 'customer';
  error?: string;
};

export async function refreshRole(tenantId: string, method: 'GET' | 'POST' = 'GET'): Promise<RefreshRoleResp> {
  if (!tenantId) return { ok: false, error: 'Missing tenantId' };

  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) return { ok: false, error: 'Not signed in' };

  const token = await user.getIdToken();

  const res = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    // Evita cachear respuestas de rol
    cache: 'no-store',
  });

  // Si te interesa capturar 405/401 explícitamente:
  if (!res.ok) {
    const err = await safeJson(res);
    return { ok: false, error: err?.error || `HTTP ${res.status}` };
  }

  const data = (await res.json()) as RefreshRoleResp;
  return data;
}

async function safeJson(res: Response) {
  try { return await res.json(); } catch { return null; }
}
