export function getPayPalBase() {
  const env = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
  return env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

function getServerCreds() {
  const id = process.env.PAYPAL_CLIENT_ID?.trim();
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    // 👇 log visible SOLO en server (no imprime secretos)
    console.error('[paypal] missing server creds', {
      id_present: Boolean(id),
      secret_present: Boolean(secret),
      PAYPAL_ENV: process.env.PAYPAL_ENV || null,
      VERCEL_ENV: process.env.VERCEL_ENV || null,
      NODE_ENV: process.env.NODE_ENV || null,
    });
    throw new Error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET');
  }
  return { id, secret };
}

export async function getPayPalAccessToken(): Promise<string> {
  const base = getPayPalBase();
  const { id, secret } = getServerCreds();

  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const json = await resp.json();
  if (!resp.ok || !json?.access_token) {
    console.error('[paypal] oauth2/token failed', {
      status: resp.status,
      bodyKeys: json ? Object.keys(json) : [],
    });
    throw new Error('Failed to obtain PayPal access token');
  }
  return json.access_token as string;
}
