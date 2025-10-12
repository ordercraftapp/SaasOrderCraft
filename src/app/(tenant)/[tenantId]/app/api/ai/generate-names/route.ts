// src/app/(tenant)/[tenantId]/app/api/ai/generate-names/route.ts
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
    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:ai/generate-names:POST'
    );

    // 🚩 Feature flag por tenant
    const flagRef = tDocAdmin('system_flags', tenantId, 'ai_studio');
    const flagSnap = await flagRef.get();
    const aiStudioEnabled = flagSnap.exists ? !!(flagSnap.data() as any)?.enabled : true;
    if (!aiStudioEnabled) {
      return NextResponse.json({ ok: false, error: 'AI Studio is disabled', tenantId }, { status: 503 });
    }

    // ⛔ Rate limit + Turnstile + admin
    const lim = await limitRequest(req);
    if (!lim.success) return NextResponse.json({ ok: false, error: 'Too many requests' }, { status: 429 });

    const token = req.headers.get('x-captcha-token') || '';
    if (!(await verifyTurnstile(token))) {
      return NextResponse.json({ ok: false, error: 'Captcha failed' }, { status: 403 });
    }

    await requireAdmin(req);

    // 📦 Payload
    const body = await req.json();
    const {
      category = 'Desayunos',
      cuisine = 'Latinoamericana',
      tone = 'family-friendly',
      audience = 'familias',
      baseIngredients = [],
      avoidAllergens = [],
      count = 6,
      language = 'es',
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

    // 🔮 OpenAI
    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL_ID,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that ONLY outputs valid single JSON objects.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 800,
      temperature: 0.9,
    } as any);

    const content = resp.choices?.[0]?.message?.content || '{}';
    const data = safeJsonParse<NamesPayload>(content);

    return NextResponse.json({ ok: true, tenantId, data });
  } catch (e: any) {
    const msg = e?.message || 'Server error';
    const code = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}
