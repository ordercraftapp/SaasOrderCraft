// src/lib/payments/paypal.ts
import { tDocAdmin } from '@/lib/db_admin';

export type TenantPaypalPublicCfg = {
  enabled: boolean;
  mode: 'sandbox' | 'live';
  clientId: string;
  currency: string;
};

export type TenantPaypalSecretCfg = {
  clientSecret: string;
};

export async function getTenantPaypalPublic(tenantId: string): Promise<TenantPaypalPublicCfg | null> {
  const snap = await tDocAdmin('paymentProfile', tenantId, 'default').get();
  if (!snap.exists) return null;
  const data: any = snap.data() || {};
  const p = (data.payments ?? data) || {};
  const pp = p.paypal || {};
  if (!pp.enabled || !pp.clientId) return null;
  return {
    enabled: !!pp.enabled,
    mode: (pp.mode === 'live' ? 'live' : 'sandbox') as 'sandbox' | 'live',
    clientId: String(pp.clientId),
    currency: String(pp.currency || 'GTQ').toUpperCase(),
  };
}

export async function getTenantPaypalSecret(tenantId: string): Promise<TenantPaypalSecretCfg | null> {
  // ✅ Usa tDocAdmin con 3 args para obtener el doc directamente
  const snap = await tDocAdmin('_secrets', tenantId, 'paypal').get();
  if (!snap.exists) return null;
  const data: any = snap.data() || {};
  if (!data.clientSecret) return null;
  return { clientSecret: String(data.clientSecret) };
}

export function getPaypalBase(mode: 'sandbox' | 'live', path: 'api' | 'api-m' = 'api-m') {
  const isLive = mode === 'live';
  if (path === 'api-m') return isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  return isLive ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';
}

/** Token por tenant usando clientId/clientSecret del tenant */
export async function getTenantPaypalAccessToken(
  tenantId: string,
  preferred: 'api' | 'api-m' = 'api-m'
): Promise<{ token: string; base: string; mode: 'sandbox' | 'live' }> {
  const pub = await getTenantPaypalPublic(tenantId);
  const sec = await getTenantPaypalSecret(tenantId);
  if (!pub?.enabled || !pub.clientId || !sec?.clientSecret) {
    throw new Error(`PayPal not configured for tenant ${tenantId}`);
  }
  const base = getPaypalBase(pub.mode, preferred);
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${pub.clientId}:${sec.clientSecret}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PayPal auth failed: ${res.status} ${res.statusText} ${txt}`);
  }
  const j = (await res.json()) as any;
  return { token: j.access_token as string, base, mode: pub.mode };
}
