/* src/lib/security/ratelimit.ts */
import type { NextRequest } from "next/server";

// Opcional: Upstash (solo si está configurado)
let useUpstash = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
let Ratelimit: any = null;
let Redis: any = null;
let rl: any = null;

(async () => {
  try {
    if (useUpstash) {
      // Carga dinámica para no romper el build si no instalaste @upstash/*
      const { Ratelimit: RL } = await import("@upstash/ratelimit");
      const { Redis: R } = await import("@upstash/redis");
      Ratelimit = RL;
      Redis = R;

      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      });

      // Ajusta la ventana/ratio a lo que usabas
      rl = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(30, "1 m"),
        analytics: false,
        prefix: "rl",
      });
      // Si todo bien, seguimos usando Upstash
    }
  } catch (e) {
    // Si falla la carga o la inicialización, desactivamos Upstash y hacemos bypass
    console.error("[ratelimit] init error, disabling upstash:", e);
    useUpstash = false;
    rl = null;
  }
})();

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const ip = xff.split(",")[0]?.trim();
  return ip || "127.0.0.1";
}

export async function limitRequest(req: NextRequest): Promise<{
  success: boolean;
  reason?: string;
  remaining?: number;
  limit?: number;
  reset?: number;
}> {
  // Permitir desactivar globalmente
  if (process.env.DISABLE_RATE_LIMIT === "1") {
    return { success: true, reason: "disabled" };
  }

  // Si no hay Upstash configurado, bypass suave
  if (!useUpstash || !rl) {
    return { success: true, reason: "not_configured" };
  }

  try {
    const ip = getClientIp(req);
    const path = req.nextUrl?.pathname || "";
    const key = `${ip}:${path}`;

    const res = await rl.limit(key);
    // res: { success, remaining, limit, reset }
    return res;
  } catch (e: any) {
    // ⚠️ Importante: si Upstash falla por red/credenciales, NO bloqueamos.
    console.error("[ratelimit] error, bypassing:", e?.message || e);
    return { success: true, reason: "ratelimit_error_bypassed" };
  }
}
