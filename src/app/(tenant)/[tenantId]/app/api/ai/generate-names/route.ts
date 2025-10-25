// src/app/(tenant)/[tenantId]/app/api/ai/generate-names/route.ts
import { NextRequest, NextResponse } from "next/server";
import { openai, OPENAI_MODEL_ID } from "@/lib/ai/openai";
import { safeJsonParse } from "@/lib/ai/json";
import { buildNamesPrompt } from "@/lib/ai/prompts";
import { verifyTurnstile } from "@/lib/security/turnstile";
import { limitRequest } from "@/lib/security/ratelimit";
import { requireAdmin, getUserFromRequest } from "@/lib/security/authz";
import type { NamesPayload } from "@/lib/ai/schemas";

import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { tDocAdmin } from "@/lib/db_admin";

export const runtime = "nodejs";

function isDebug(req: NextRequest) {
  return req.headers.get("x-debug") === "1" || process.env.DEBUG_AI === "1";
}

function j(err: unknown) {
  const e: any = err || {};
  return {
    name: e.name,
    message: e.message,
    status: e?.status ?? e?.response?.status,
    code: e?.code,
    data: e?.response?.data,
    stack: e?.stack,
  };
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const debug = isDebug(req);
  const stepLog = (step: string, extra?: any) => {
    if (debug) {
      console.log(`[ai/generate-names] step=${step}`, extra ?? "");
    }
  };

  try {
    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      "api:ai/generate-names:POST"
    );
    stepLog("tenant.resolve", { tenantId });

    // 🚩 Feature flag por tenant
    try {
      const flagRef = tDocAdmin("system_flags", tenantId, "ai_studio");
      const flagSnap = await flagRef.get();
      const aiStudioEnabled = flagSnap.exists ? !!(flagSnap.data() as any)?.enabled : true;
      stepLog("flag.read", { enabled: aiStudioEnabled });
      if (!aiStudioEnabled) {
        return NextResponse.json(
          { ok: false, error: "AI Studio is disabled", step: "flag" },
          { status: 503, headers: { "Cache-Control": "no-store" } }
        );
      }
    } catch (e) {
      stepLog("flag.error", j(e));
      // No detengas por flag si prefieres, pero mejor explícito:
      return NextResponse.json(
        { ok: false, error: "Flag read failed", step: "flag", detail: j(e) },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // ⛔ Rate limit
    try {
      const lim = await limitRequest(req);
      stepLog("ratelimit", lim);
      if (!lim.success) {
        return NextResponse.json(
          { ok: false, error: "Too many requests", step: "ratelimit" },
          { status: 429, headers: { "Cache-Control": "no-store" } }
        );
      }
    } catch (e) {
      stepLog("ratelimit.error", j(e));
      return NextResponse.json(
        { ok: false, error: "Rate limit error", step: "ratelimit", detail: j(e) },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 🤖 Turnstile
    try {
      const token = req.headers.get("x-captcha-token") || "";
      const ok = await verifyTurnstile(token);
      stepLog("captcha.verify", { ok, hasToken: !!token });
      if (!ok) {
        return NextResponse.json(
          { ok: false, error: "Captcha failed", step: "captcha" },
          { status: 403, headers: { "Cache-Control": "no-store" } }
        );
      }
    } catch (e) {
      stepLog("captcha.error", j(e));
      return NextResponse.json(
        { ok: false, error: "Captcha verification error", step: "captcha", detail: j(e) },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 👮 Admin
    try {
      const rawUser = await getUserFromRequest(req);
      stepLog("auth.peek", { hasUser: !!rawUser, roles: rawUser?.roles });
      await requireAdmin(req); // tira 401/403 si no
      stepLog("auth.requireAdmin.ok");
    } catch (e) {
      stepLog("auth.requireAdmin.error", j(e));
      const msg = (e as any)?.message || "Unauthorized";
      const code = /unauthor/i.test(msg) ? 401 : /forbid/i.test(msg) ? 403 : 500;
      return NextResponse.json(
        { ok: false, error: msg, step: "auth" },
        { status: code, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 📦 Payload
    let body: any = {};
    try {
      body = await req.json();
      stepLog("body", body);
    } catch (e) {
      stepLog("body.error", j(e));
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body", step: "body", detail: j(e) },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }

    const {
      category = "Desayunos",
      cuisine = "Latinoamericana",
      tone = "family-friendly",
      audience = "familias",
      baseIngredients = [],
      avoidAllergens = [],
      count = 6,
      language = "es",
    } = body || {};

    // 🧠 Prompt
    const prompt = buildNamesPrompt({
      category,
      cuisine,
      tone,
      audience,
      baseIngredients,
      avoidAllergens,
      count,
      language,
    });
    stepLog("prompt.ready", { model: OPENAI_MODEL_ID });

    // 🔮 OpenAI con manejo fino de errores
    let resp;
    try {
      resp = await openai.chat.completions.create({
        model: OPENAI_MODEL_ID,
        messages: [
          { role: "system", content: "You are a helpful assistant that ONLY outputs valid single JSON objects." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        max_tokens: 800,
        temperature: 0.9,
      } as any);
      stepLog("openai.ok");
    } catch (err: any) {
      const status = err?.status || err?.response?.status || 500;
      const detail =
        err?.error?.message ||
        err?.response?.data?.error?.message ||
        err?.message ||
        "OpenAI error";
      stepLog("openai.error", { status, detail, raw: j(err) });

      return NextResponse.json(
        { ok: false, error: `OpenAI: ${detail}`, step: "openai", detail: debug ? j(err) : undefined },
        { status: [401, 403, 404, 408, 409, 422, 429, 500].includes(status) ? status : 500,
          headers: { "Cache-Control": "no-store" } }
      );
    }

    const content = resp.choices?.[0]?.message?.content || "{}";
    const data = safeJsonParse<NamesPayload>(content);
    stepLog("parse.ok", { items: data?.items?.length });

    return NextResponse.json(
      { ok: true, tenantId, data },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    console.error("[ai/generate-names] fatal", j(e));
    const msg = e?.message || "Server error";
    const code = /unauthor/i.test(msg) ? 401 : /forbid/i.test(msg) ? 403 : 500;
    return NextResponse.json(
      { ok: false, error: msg, step: "fatal", detail: isDebug(req) ? j(e) : undefined },
      { status: code, headers: { "Cache-Control": "no-store" } }
    );
  }
}
