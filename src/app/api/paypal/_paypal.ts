export const RUNTIME = 'nodejs';

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

export function getPayPalBase(): string {
  const env = (process.env.PAYPAL_ENV || 'sandbox').toLowerCase();
  return env === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

export async function getPayPalAccessToken(): Promise<string> {
  const clientId = getEnv('PAYPAL_CLIENT_ID');
  const secret   = getEnv('PAYPAL_CLIENT_SECRET');
  const base     = getPayPalBase();

  const creds = Buffer.from(`${clientId}:${secret}`).toString('base64');

  const resp = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok || !json?.access_token) {
    console.error('[paypal:_paypal] oauth fail', { status: resp.status, bodyKeys: Object.keys(json || {}) });
    throw new Error('PayPal OAuth failed');
  }
  return json.access_token as string;
}
