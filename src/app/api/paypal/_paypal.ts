// src/app/api/paypal/_paypal.ts
export function getPayPalBase() {
  const env = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export async function getPayPalAccessToken() {
  const base = getPayPalBase();
  const cid = process.env.PAYPAL_CLIENT_ID!;
  const sec = process.env.PAYPAL_CLIENT_SECRET!;
  if (!cid || !sec) throw new Error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');

  const creds = Buffer.from(`${cid}:${sec}`).toString('base64');
  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`[paypal] oauth failed: ${resp.status} ${text}`);
  }
  const json = await resp.json();
  return json?.access_token as string;
}
