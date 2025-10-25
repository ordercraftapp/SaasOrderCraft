import { NextRequest, NextResponse } from 'next/server';
import { openai, OPENAI_MODEL_ID } from '@/lib/ai/openai';
import { safeJsonParse } from '@/lib/ai/json';
import { buildNamesPrompt } from '@/lib/ai/prompts';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { limitRequest } from '@/lib/security/ratelimit';
import { requireAdmin } from '@/lib/security/authz';
import type { NamesPayload } from '@/lib/ai/schemas';

import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tDocAdmin } from '@/lib/db_admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:ai/generate-names:POST'
    );

    const flagRef = tDocAdmin('system_flags', tenantId, 'ai_studio');
    const flagSnap = await flagRef.get();
    const aiStudioEnabled = flagSnap.exists ? !!(flagSnap.data() as any)?.enabled : true;
    if (!aiStudioEnabled) {
      return NextResponse.json(
        { ok: false, error: 'AI Studio is disabled', tenantId },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const lim = await limitRequest(req);
    if (!lim.success) {
      return NextResponse.json(
        { ok: false, error: 'Too many requests' },
        { status: 429, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const token = req.headers.get('x-captcha-token') || '';
    if (!(await verifyTurnstile(token))) {
      return NextResponse.json(
        { ok: false, error: 'Captcha failed' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    await requireAdmin(req);

    // 🔑 Guard env (mensaje claro si falta la key o el modelo)
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { ok: false, error: 'Missing OPENAI_API_KEY on server' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    if (!OPENAI_MODEL_ID) {
      return NextResponse.json(
        { ok: false, error: 'Missing OPENAI_MODEL_ID on server' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const body = await req.json().catch(() => ({}));
    let {
      category = 'Desayunos',
      cuisine = 'Latinoamericana',
      tone = 'family-friendly',
      audience = 'familias',
      baseIngredients = [],
      avoidAllergens = [],
      count = 6,
      language = 'es',
    } = (body || {}) as Partial<{
      category: string;
      cuisine: string;
      tone: string;
      audience: string;
      baseIngredients: string[];
      avoidAllergens: string[];
      count: number;
      language: 'es' | 'en';
    }>;

    count = Math.min(20, Math.max(1, Number.isFinite(count as number) ? (count as number) : 6));
    baseIngredients = Array.isArray(baseIngredients) ? baseIngredients.slice(0, 30) : [];
    avoidAllergens = Array.isArray(avoidAllergens) ? avoidAllergens.slice(0, 30) : [];

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

    // 🔮 OpenAI (con manejo explícito de errores)
    let resp: any;
    try {
      resp = await openai.chat.completions.create({
        model: OPENAI_MODEL_ID,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that ONLY outputs valid single JSON objects.' },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 800,
        temperature: 0.9,
      } as any);
    } catch (err: any) {
      const status = err?.status || err?.response?.status || 500;
      const detail =
        err?.error?.message ||
        err?.response?.data?.error?.message ||
        err?.message ||
        'OpenAI error';
      console.error('[openai] generate-names error', { status, detail });
      return NextResponse.json(
        { ok: false, error: `OpenAI: ${detail}` },
        { status: [401,403,404,408,409,422,429,500].includes(status) ? status : 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const content = resp.choices?.[0]?.message?.content || '{}';
    const data = safeJsonParse<NamesPayload>(content) || { items: [] };

    return NextResponse.json(
      { ok: true, tenantId, data },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (e: any) {
    const msg = e?.message || 'Server error';
    const status =
      /unauthor/i.test(msg) ? 401 :
      /forbid|insufficient/i.test(msg) ? 403 :
      /rate|quota|exceed|429/.test(msg) ? 429 :
      500;
    return NextResponse.json(
      { ok: false, error: msg },
      { status, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
