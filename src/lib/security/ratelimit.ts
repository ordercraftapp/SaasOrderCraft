import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextRequest } from "next/server";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.fixedWindow( // p.ej. 30/min por IP
    30, "60 s"
  ),
  prefix: "ai-studio",
});

export async function limitRequest(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || (req as any).ip
    || "0.0.0.0";
  return limiter.limit(ip);
}
