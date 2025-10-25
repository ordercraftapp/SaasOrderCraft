import { NextRequest, NextResponse } from "next/server";
import { openai, OPENAI_MODEL_ID } from "@/lib/ai/openai";
import { safeJsonParse } from "@/lib/ai/json";
import { buildImagePromptPrompt } from "@/lib/ai/prompts";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { limitRequest } from "@/lib/security/ratelimit";
import { requireAdmin } from "@/lib/security/authz";
import type { ImagePromptsPayload } from "@/lib/ai/schemas";

import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { tDocAdmin } from "@/lib/db_admin";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      "api:ai/generate-image-prompts:POST"
    );

    const flagRef = tDocAdmin("system_flags", tenantId, "ai_studio");
    const flagSnap = await flagRef.get();
    const aiStudioEnabled = flagSnap.exists ? !!(flagSnap.data() as any)?.enabled : true;
    if (!aiStudioEnabled) {
      return NextResponse.json(
        { ok: false, error: "AI Studio is disabled", tenantId },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const lim = await limitRequest(req);
    if (!lim.success) {
      return NextResponse.json(
        { ok: false, error: "Too many requests" },
        { status: 429, headers: { "Cache-Control": "no-store" } }
      );
    }

    const token = req.headers.get("x-captcha-token") || "";
    if (!(await verifyTurnstile(token))) {
      return NextResponse.json(
        { ok: false, error: "Captcha failed" },
        { status: 403, headers: { "Cache-Control": "no-store" } }
      );
    }

    await requireAdmin(req); // o await requireAdmin(req, tenantId)

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_API_KEY on server", tenantId },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (!OPENAI_MODEL_ID) {
      return NextResponse.json(
        { ok: false, error: "Missing OPENAI_MODEL_ID on server", tenantId },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const {
      items = [] as Array<{ name: string; ingredients?: string[] }>,
      language = "es",
    } = (body || {}) as {
      items?: Array<{ name: string; ingredients?: string[] }>;
      language?: "es" | "en";
    };

    if (!items.length) {
      return NextResponse.json(
        { ok: false, error: "items[] required" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const prompt = buildImagePromptPrompt({
      items: items.slice(0, 20),
      language,
    });

    let resp: any;
    try {
      resp = await openai.chat.completions.create({
        model: OPENAI_MODEL_ID,
        messages: [
          { role: "system", content: "You are a helpful assistant that ONLY outputs valid single JSON objects." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 1200,
        temperature: 0.7,
      } as any);
    } catch (err: any) {
      const status = err?.status || err?.response?.status || 500;
      const detail =
        err?.error?.message ||
        err?.response?.data?.error?.message ||
        err?.message ||
        "OpenAI error";
      const cause = err?.cause || {};
      console.error("[openai] generate-image-prompts error", {
        status,
        detail,
        net: { type: err?.type, code: cause?.code, errno: cause?.errno, syscall: cause?.syscall },
      });
      return NextResponse.json(
        { ok: false, error: `OpenAI: ${detail}`, tenantId },
        { status: [401,403,404,408,409,422,429,500].includes(status) ? status : 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const content = resp.choices?.[0]?.message?.content || "{}";
    const data = safeJsonParse<ImagePromptsPayload>(content);

    return NextResponse.json(
      { ok: true, data, tenantId },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message || "Server error";
    const code =
      /unauthor/i.test(msg) ? 401 :
      /forbid/i.test(msg) ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: msg },
      { status: code, headers: { "Cache-Control": "no-store" } }
    );
  }
}
