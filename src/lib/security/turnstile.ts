// src/lib/security/turnstile.ts

export async function verifyTurnstile(token?: string) {
  if (!token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY || "",
        response: token,
      }),
    });
    const data = await r.json();
    return !!data.success;
  } catch {
    return false;
  }
}
