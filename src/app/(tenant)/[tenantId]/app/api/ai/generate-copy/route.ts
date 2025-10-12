// src/app/(tenant)/[tenantId]/app/api/ai/generate-copy/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { openai, OPENAI_MODEL_ID } from '@/lib/ai/openai';
import { safeJsonParse } from '@/lib/ai/json';
import { buildCopyPrompt } from '@/lib/ai/prompts';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { limitRequest } from '@/lib/security/ratelimit';
import { requireAdmin } from '@/lib/security/authz';
import type { CopyPayload } from '@/lib/ai/schemas';

import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tDocAdmin } from '@/lib/db_admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:ai/generate-copy:POST'
    );

    // 🚩 Feature flag por tenant: tenants/{tenantId}/system_flags/ai_studio
    const flagRef = tDocAdmin('system_flags', tenantId, 'ai_studio');
    const flagSnap = await flagRef.get();
    const aiStudioEnabled = flagSnap.exists ? !!(flagSnap.data() as any)?.enabled : true;
    if (!aiStudioEnabled) {
      return NextResponse.json({ ok: false, error: 'AI Studio is disabled', tenantId }, { status: 503 });
    }

    // ⛔ Rate limit + Turnstile + auth admin
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
      names = [] as string[],
      tone = 'family-friendly',
      language = 'es',
      seoKeywords = [] as string[],
    } = body || {};
    if (!names.length) {
      return NextResponse.json({ ok: false, error: 'names[] required' }, { status: 400 });
    }

    // 🧠 Prompt
    const prompt = buildCopyPrompt({ names, tone, language, seoKeywords });

    // 🔮 OpenAI
    const resp = await openai.chat.completions.create({
      model: OPENAI_MODEL_ID,
      messages: [
        { role: 'system', content: 'You are a helpful assistant that ONLY outputs valid single JSON objects.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1600,
      temperature: 0.8,
    } as any);

    const content = resp.choices?.[0]?.message?.content || '{}';
    const data = safeJsonParse<CopyPayload>(content);

    return NextResponse.json({ ok: true, tenantId, data });
  } catch (e: any) {
    const msg = e?.message || 'Server error';
    const code = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}
