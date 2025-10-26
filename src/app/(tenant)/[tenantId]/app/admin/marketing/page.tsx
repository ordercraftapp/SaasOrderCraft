// src/app/(tenant)/[tenantId]/app/admin/marketing/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import AdminOnly from '@/app/(tenant)/[tenantId]/components/AdminOnly';
import ToolGate from '@/components/ToolGate';
import { useAuth } from '@/app/(tenant)/[tenantId]/app/providers';

// Mantén estos imports si ya añadiste el editor visual y uploads
import '@/lib/firebase/client';
import { getApp } from 'firebase/app';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

type BrevoContact = {
  id: number | string;
  email: string;
  firstName?: string;
  lastName?: string;
  status?: string; // 'subscribed'|'unsubscribed'|'blacklisted'|...
  lists?: Array<{ id: number | string; name: string }>;
  createdAt?: string; // ISO
  attributes?: Record<string, any>;
  tags?: string[];
};

/* --------------------------------------------
   API base (tenant-scoped)
--------------------------------------------- */
function useApiBase() {
  const params = useParams();
  const tenantId = String((params as any)?.tenantId ?? (params as any)?.tenant ?? '').trim();
  // Todas las APIs viven bajo: /[tenantId]/app/api/...
  return tenantId ? `/${tenantId}/app/api` : `/invalid-tenant/app/api`;
}

function AdminMarketingPage_Inner() {
  const apiBase = useApiBase();

  // 🔤 idioma actual + helper
  const { settings } = useTenantSettings();
  const lang = useMemo(() => {
    try {
      if (typeof window !== 'undefined') {
        const ls = localStorage.getItem('tenant.language');
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);

  // tt seguro: siempre devuelve string (evita React #130)
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    try {
      const s = translate(lang, key, vars);
      if (typeof s === 'string') return s === key ? fallback : s;
    } catch {}
    return fallback;
  };

  const { idToken, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('<h1>Hola 👋</h1><p>Este es un ejemplo de campaña.</p>');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [testEmail, setTestEmail] = useState('');
  const [includeAllCustomers, setIncludeAllCustomers] = useState(false);

  // ====== NUEVO: Tabs principales (Compose | Campaigns | Contacts)
  const [mainTab, setMainTab] = useState<'compose' | 'campaigns' | 'contacts'>('compose');

  // ====== Content Assistant / Editor
  const [showAssist, setShowAssist] = useState(true);
  const [previewText, setPreviewText] = useState('Limited-time offer inside!');
  const [activeTab, setActiveTab] = useState<'templates' | 'checklist' | 'preview' | 'snippets'>('templates');
  const [editorMode, setEditorMode] = useState<'visual' | 'html'>('visual');
  const visualRef = useRef<HTMLDivElement | null>(null);
  const suppressMirrorRef = useRef(false);

  // Upload imagen
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Button builder
  const [btnLabel, setBtnLabel] = useState('Order now');
  const [btnEmoji, setBtnEmoji] = useState('🍔');
  const [btnHref, setBtnHref] = useState('https://example.com/order');
  const [btnBg, setBtnBg] = useState('#0d6efd');
  const [btnFg, setBtnFg] = useState('#ffffff');
  const [btnRadius, setBtnRadius] = useState(8);
  const [btnPaddingY, setBtnPaddingY] = useState(12);
  const [btnPaddingX, setBtnPaddingX] = useState(18);
  const [btnSize, setBtnSize] = useState<'sm' | 'md' | 'lg'>('md');

  // ====== Contacts (Brevo)
  const [contacts, setContacts] = useState<BrevoContact[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [contactsPageSize, setContactsPageSize] = useState(25);
  const [contactsOffset, setContactsOffset] = useState(0);
  const [contactsSearch, setContactsSearch] = useState('');
  const [contactsStatus, setContactsStatus] = useState<'all' | 'subscribed' | 'unsubscribed' | 'blacklisted'>('all');
  const [contactsBusy, setContactsBusy] = useState(false);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<BrevoContact | null>(null);

  const hasAuth = !!idToken && !loading;

async function call(path: string, opts?: RequestInit) {
  if (!idToken) throw new Error(tt('admin.marketing.err.missingToken', 'Missing idToken'));

  // prefer opts values but provide sensible defaults
  const method = (opts && (opts.method as string)) || 'POST';
  const extraHeaders = (opts && (opts.headers as any)) || {};
  const rawBody = opts && (opts as any).body;

  // if body is already a string use it, otherwise JSON.stringify non-empty objects
  const body =
    rawBody === undefined || rawBody === null
      ? undefined
      : typeof rawBody === 'string'
      ? rawBody
      : JSON.stringify(rawBody);

  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      'content-type': 'application/json',
      'x-debug-auth': '1', // <— SOLO para debug
      ...extraHeaders,
    },
    body,
  });

  const jr = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(jr?.error || tt('admin.marketing.err.request', 'Request error'));
  return jr;
}

  // ====== Setup/Sync/Campaigns (TENANT API)
  async function onSetup() {
    setBusy(true);
    setLog((l) => [...l, tt('admin.marketing.log.setup', 'Setup…')]);
    try {
      const r = await call(`${apiBase}/marketing/brevo/setup`, { method: 'POST' });
      setLog((l) => [
        ...l,
        tt('admin.marketing.log.setupOk', 'OK: listId={listId}', { listId: r?.config?.listId }),
      ]);
    } catch (e: any) {
      setLog((l) => [...l, `${tt('admin.marketing.log.error', 'Error')}: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }
  async function onSyncCustomers() {
    setBusy(true);
    setLog((l) => [
      ...l,
      tt('admin.marketing.log.syncCustomers', 'Sync customers (includeAll={x})…', {
        x: includeAllCustomers ? '1' : '0',
      }),
    ]);
    try {
      const r = await call(
        `${apiBase}/marketing/brevo/sync-contacts?includeAll=${includeAllCustomers ? '1' : '0'}`,
        { method: 'POST' },
      );
      setLog((l) => [
        ...l,
        tt(
          'admin.marketing.log.syncCustomersOk',
          'Customers → Brevo OK: total={t} created={c} updated={u} failed={f} (skippedNoEmail={se}, skippedNoOptin={so})',
          {
            t: r?.total,
            c: r?.created,
            u: r?.updated,
            f: r?.failed?.length,
            se: r?.skippedNoEmail,
            so: r?.skippedNoOptin,
          },
        ),
      ]);
    } catch (e: any) {
      setLog((l) => [...l, `${tt('admin.marketing.log.error', 'Error')}: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }
  async function onSyncAuthUsers() {
    setBusy(true);
    setLog((l) => [...l, tt('admin.marketing.log.syncAuth', 'Sync Firebase Auth…')]);
    try {
      const r = await call(`${apiBase}/marketing/brevo/sync-auth-users`, { method: 'POST' });
      setLog((l) => [
        ...l,
        tt('admin.marketing.log.syncAuthOk', 'Auth → Brevo OK: total={t} created={c} updated={u} failed={f}', {
          t: r?.total,
          c: r?.created,
          u: r?.updated,
          f: r?.failed?.length,
        }),
      ]);
    } catch (e: any) {
      setLog((l) => [...l, `${tt('admin.marketing.log.error', 'Error')}: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }
  async function onSyncAll() {
    setBusy(true);
    setLog((l) => [
      ...l,
      tt('admin.marketing.log.syncAll', 'Sync ALL (Auth + Customers; includeFirestoreAll={x})…', {
        x: includeAllCustomers ? '1' : '0',
      }),
    ]);
    try {
      const r = await call(
        `${apiBase}/marketing/brevo/sync-all?includeFirestoreAll=${includeAllCustomers ? '1' : '0'}`,
        { method: 'POST' },
      );
      setLog((l) => [
        ...l,
        tt(
          'admin.marketing.log.syncAllOk',
          'ALL → Brevo OK: total={t} created={c} updated={u} failed={f} (auth={a}, customers={cu})',
          {
            t: r?.total,
            c: r?.created,
            u: r?.updated,
            f: r?.failed?.length,
            a: r?.sourceCounts?.auth,
            cu: r?.sourceCounts?.customers,
          },
        ),
      ]);
    } catch (e: any) {
      setLog((l) => [...l, `${tt('admin.marketing.log.error', 'Error')}: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }
  async function onCreateCampaign() {
    setBusy(true);
    try {
      const r = await call(`${apiBase}/marketing/brevo/campaigns`, {
        method: 'POST',
        body: JSON.stringify({ subject, html }),
      });
      setLog((l) => [
        ...l,
        tt('admin.marketing.log.campaignCreated', 'Campaign created: id={id}', { id: r?.campaign?.id }),
      ]);
      await refreshCampaigns();
      setMainTab('campaigns');
    } catch (e: any) {
      setLog((l) => [...l, `${tt('admin.marketing.log.error', 'Error')}: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }
  async function onSendNow(id: number) {
    setBusy(true);
    try {
      await call(`${apiBase}/marketing/brevo/campaigns/${id}/send-now`, { method: 'POST' });
      setLog((l) => [...l, tt('admin.marketing.log.campaignSent', 'Campaign sent {id}', { id })]);
      await refreshCampaigns();
    } catch (e: any) {
      setLog((l) => [...l, `${tt('admin.marketing.log.error', 'Error')}: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }
  async function onSendTest(id: number) {
    if (!testEmail) {
      alert(tt('admin.marketing.alert.enterTestEmail', 'Enter email for test.'));
      return;
    }
    setBusy(true);
    try {
      await call(`${apiBase}/marketing/brevo/campaigns/${id}/send-test`, {
        method: 'POST',
        body: JSON.stringify({ emailTo: [testEmail] }),
      });
      setLog((l) => [
        ...l,
        tt('admin.marketing.log.testSent', 'Test sent to {email}', { email: testEmail }),
      ]);
    } catch (e: any) {
      setLog((l) => [...l, `${tt('admin.marketing.log.error', 'Error')}: ${e?.message || e}`]);
    } finally {
      setBusy(false);
    }
  }
  async function refreshCampaigns() {
    try {
      const r = await call(`${apiBase}/marketing/brevo/campaigns`, { method: 'GET' });
      setCampaigns(r?.campaigns || []);
    } catch {}
  }
  useEffect(() => {
    if (hasAuth) refreshCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAuth, apiBase]);

  // ====== Utilidades de content (sanitizado/editor)
  const spammyWords = useMemo(
    () => ['free!!!', 'win money', 'click here', 'act now', 'urgent', 'congratulations', 'offer expires', 'risk-free'],
    [],
  );
  const subjectLen = subject.trim().length;
  const subjectHasVerb = /\b(order|get|claim|reserve|save|enjoy|try|discover|taste|unlock)\b/i.test(subject);
  const SubjectTip = ({ ok, text }: { ok: boolean; text: string }) => (
    <div className={`small d-flex align-items-center ${ok ? 'text-success' : 'text-muted'}`}>
      <span
        className={`me-2 badge rounded-pill ${
          ok ? 'bg-success-subtle text-success' : 'bg-light text-muted border'
        }`}
      >
        {ok ? '✓' : '•'}
      </span>
      {text}
    </div>
  );
  function stripHtml(s: string) {
    if (!s) return '';
    const tmp = typeof window !== 'undefined' ? document.createElement('div') : null;
    if (tmp) {
      tmp.innerHTML = s;
      return (tmp.textContent || tmp.innerText || '').trim();
    }
    return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const plain = useMemo(() => stripHtml(html), [html]);
  const inboxPreview = useMemo(() => (previewText || plain || '').slice(0, 120), [previewText, plain]);

  const hasCTAButton =
    /<a\b[^>]*class=["'][^"']*btn[^"']*["'][^>]*>/i.test(html) || /\bcta\b/i.test(html);
  const hasImgAlt = /<img[^>]+alt=/i.test(html) || !/<img/i.test(html);
  const usesSpammyWords =
    spammyWords.some((w) => subject.toLowerCase().includes(w) || plain.toLowerCase().includes(w));
  const hasBranding =
    /logo|brand|marca|Restaurant|OrderCraft|DataCraft/i.test(html) || /©|unsubscribe/i.test(html);

  const templates = [
    {
      name: 'Weekend Promo',
      subject: 'Weekend cravings? 20% off comfort food 🍔',
      html: `
<section style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <header style="text-align:center;padding:8px 0">
    <img src="https://via.placeholder.com/140x40?text=Your+Logo" alt="Your brand" style="max-width:140px;height:auto"/>
  </header>
  <h1 style="margin:16px 0 8px">Burgers, ribs & comfort food you’ll never forget</h1>
  <p style="margin:0 0 16px;color:#555">This weekend only. Show this email at checkout or order online.</p>
  <a href="https://example.com/order" class="btn" style="display:inline-block;padding:12px 18px;border-radius:8px;text-decoration:none;background:#0d6efd;color:#fff;font-weight:600">Order now</a>
  <hr style="margin:24px 0;border:none;border-top:1px solid #eee"/>
  <p style="font-size:12px;color:#888">You are receiving this because you opted in at our store. Unsubscribe options are handled by Brevo.</p>
</section>`.trim(),
    },
    {
      name: 'New Menu Item',
      subject: 'Meet our new smoky BBQ ribs 🔥',
      html: `
<section style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">New arrival: Smoky BBQ Ribs</h2>
  <p style="margin:0 0 16px;color:#555">Slow-cooked, fall-off-the-bone delicious. Limited launch pricing this week.</p>
  <img src="https://via.placeholder.com/640x280?text=BBQ+Ribs" alt="Smoky BBQ Ribs" style="width:100%;height:auto;border-radius:10px"/>
  <p style="margin:16px 0">
    <a href="https://example.com/menu" class="btn" style="display:inline-block;padding:12px 18px;border-radius:8px;text-decoration:none;background:#198754;color:#fff;font-weight:600">Try it today</a>
  </p>
  <p style="font-size:12px;color:#888">Allergen info available on menu page.</p>
</section>`.trim(),
    },
    {
      name: 'Loyalty',
      subject: 'Your 2x points are waiting ✨',
      html: `
<section style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Double points this week</h2>
  <p style="margin:0 0 16px;color:#555">Members earn 2x points on all burgers & shakes. Don’t miss out.</p>
  <a href="https://example.com/rewards" class="btn" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#6f42c1;color:#fff;font-weight:600;text-decoration:none">Claim reward</a>
</section>`.trim(),
    },
    {
      name: 'Holiday',
      subject: 'Holiday feast, no stress 🎄',
      html: `
<section style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
  <h2 style="margin:0 0 8px">Stress-free holiday menu</h2>
  <p style="margin:0 0 16px;color:#555">Pre-order your favorites and enjoy more time with family.</p>
  <ul style="margin:0 0 16px;color:#555">
    <li>Family trays</li>
    <li>Dessert bundles</li>
    <li>Gift cards</li>
  </ul>
  <a href="https://example.com/holiday" class="btn" style="display:inline-block;padding:12px 18px;border-radius:8px;text-decoration:none;background:#dc3545;color:#fff;font-weight:600">Pre-order now</a>
</section>`.trim(),
    },
  ];
  function applyTemplate(t: { subject: string; html: string }) {
    setSubject(t.subject);
    setHtml(t.html);
  }

  const subjectIdeas = [
    'Your exclusive offer is waiting 🍔',
    'Cravings? We’ve got you covered.',
    'Tonight’s the night: treat yourself!',
    'Small hunger, big flavors.',
    'New drop just landed 👀',
  ];
  function inspireSubject() {
    setSubject(subjectIdeas[Math.floor(Math.random() * subjectIdeas.length)]);
  }

  const snippetHero = `
<section style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;text-align:center">
  <img src="https://via.placeholder.com/640x260?text=Your+Hero" alt="Hero image" style="width:100%;height:auto;border-radius:10px"/>
  <h1 style="margin:16px 0 8px">Title that creates appetite</h1>
  <p style="margin:0 0 16px;color:#555">Short, benefit-driven subtitle. Keep it under 100 characters.</p>
</section>`.trim();
  const snippetTwoCols = `
<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 auto;max-width:640px">
  <tr>
    <td style="width:50%;padding:8px;vertical-align:top">
      <img src="https://via.placeholder.com/300x200?text=Dish+1" alt="Dish 1" style="width:100%;height:auto;border-radius:8px"/>
      <h3 style="margin:8px 0">Star Dish</h3>
      <p style="margin:0;color:#555">A quick tasty description.</p>
    </td>
    <td style="width:50%;padding:8px;vertical-align:top">
      <img src="https://via.placeholder.com/300x200?text=Dish+2" alt="Dish 2" style="width:100%;height:auto;border-radius:8px"/>
      <h3 style="margin:8px 0">Sweet Treat</h3>
      <p style="margin:0;color:#555">A short irresistible blurb.</p>
    </td>
  </tr>
</table>`.trim();
  function insertSnippet(s: string) {
    insertAtCursorHTML(s);
  }

  // Editor helpers
  function exec(cmd: string, val?: string) {
    document.execCommand(cmd, false, val);
    mirrorFromVisual();
  }
  function insertAtCursorHTML(snippet: string) {
    if (editorMode === 'visual' && visualRef.current) {
      visualRef.current.focus();
      try {
        document.execCommand('insertHTML', false, snippet);
      } catch {}
      mirrorFromVisual();
    } else {
      setHtml((h) => (h ? h + '\n\n' + snippet : snippet));
    }
  }
  function sanitizeHtml(input: string) {
    const div = document.createElement('div');
    div.innerHTML = input;
    const walker = document.createTreeWalker(div, NodeFilter.SHOW_ELEMENT, null);
    const toRemove: Element[] = [];
    while (walker.nextNode()) {
      const el = walker.currentNode as Element;
      const tag = el.tagName.toLowerCase();
      if (tag === 'script' || tag === 'iframe' || tag === 'object' || tag === 'embed') {
        toRemove.push(el);
        continue;
      }
      [...(el.attributes as any)].forEach((attr: Attr) => {
        const n = attr.name.toLowerCase();
        if (n.startsWith('on')) el.removeAttribute(attr.name);
        if (n === 'style') {
          const safe = (attr.value || '')
            .split(';')
            .map((s) => s.trim())
            .filter((s) =>
              /^(color|background|padding|margin|border|text-align|font-weight|font-size|border-radius|display|width|height|max-width)\s*:/i.test(
                s,
              ),
            )
            .join('; ');
          if (safe) el.setAttribute('style', safe);
          else el.removeAttribute('style');
        }
      });
    }
    toRemove.forEach((n) => n.remove());
    return div.innerHTML;
  }
  function mirrorFromVisual() {
    if (!visualRef.current) return;
    suppressMirrorRef.current = true;
    const inner = visualRef.current.innerHTML || '';
    setHtml(sanitizeHtml(inner));
    setTimeout(() => (suppressMirrorRef.current = false), 0);
  }
  useEffect(() => {
    if (editorMode !== 'visual' || !visualRef.current) return;
    if (suppressMirrorRef.current) return;
    const cur = visualRef.current.innerHTML || '';
    if (cur !== html) visualRef.current.innerHTML = html || '';
  }, [html, editorMode]);
  function onVisualInput() {
    mirrorFromVisual();
  }
  function onVisualPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    const text = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
    insertAtCursorHTML(sanitizeHtml(text));
  }

  // Upload imagen a Storage (opcional: incluir tenantId en la ruta si quieres aislar assets por tenant)
  async function onPickFile() {
    fileInputRef.current?.click();
  }
  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setUploadingImage(true);
      const app = getApp();
      const storage = getStorage(app);
      const path = `marketing/uploads/${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file, { contentType: file.type });
      const url = await getDownloadURL(ref);
      const alt = prompt(tt('admin.marketing.prompt.alt', 'ALT text (short description):')) || file.name;
      insertAtCursorHTML(
        `<img src="${url}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px"/>`,
      );
      setLog((l) => [...l, tt('admin.marketing.log.imageUploaded', 'Image uploaded: {path}', { path })]);
    } catch (err: any) {
      alert(`${tt('admin.marketing.alert.uploadFailed', 'Upload failed')}: ${err?.message || err}`);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }
  function insertImageByUrl() {
    const url = prompt(tt('admin.marketing.prompt.imageUrl', 'Image URL (https://):')) || '';
    if (!url) return;
    const alt = prompt(tt('admin.marketing.prompt.alt', 'ALT text (short description):')) || 'Image';
    insertAtCursorHTML(
      `<img src="${url}" alt="${alt}" style="max-width:100%;height:auto;border-radius:8px"/>`,
    );
  }

  // Button builder
  function buttonHtml() {
    const py = btnSize === 'sm' ? Math.max(8, btnPaddingY - 4) : btnSize === 'lg' ? btnPaddingY + 4 : btnPaddingY;
    const px = btnSize === 'sm' ? Math.max(12, btnPaddingX - 4) : btnSize === 'lg' ? btnPaddingX + 4 : btnPaddingX;
    const label = `${btnEmoji ? btnEmoji + ' ' : ''}${btnLabel}`.trim();
    const style = [
      `display:inline-block`,
      `text-decoration:none`,
      `background:${btnBg}`,
      `color:${btnFg}`,
      `padding:${py}px ${px}px`,
      `border-radius:${btnRadius}px`,
      `font-weight:600`,
    ].join(';');
    return `<a href="${btnHref}" class="btn cta" style="${style}">${label
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</a>`;
  }
  function insertBuiltButton() {
    insertAtCursorHTML(buttonHtml());
  }
  function setPreset(preset: 'primary' | 'success' | 'danger' | 'dark') {
    if (preset === 'primary') {
      setBtnBg('#0d6efd');
      setBtnFg('#ffffff');
    }
    if (preset === 'success') {
      setBtnBg('#198754');
      setBtnFg('#ffffff');
    }
    if (preset === 'danger') {
      setBtnBg('#dc3545');
      setBtnFg('#ffffff');
    }
    if (preset === 'dark') {
      setBtnBg('#212529');
      setBtnFg('#ffffff');
    }
  }

  // ====== Fetch Contacts (TENANT API)
  async function fetchContacts(params?: {
    search?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    setContactsBusy(true);
    setContactsError(null);
    try {
      const q = new URLSearchParams();
      if (params?.search) q.set('search', params.search);
      if (params?.status && params.status !== 'all') q.set('status', params.status);
      q.set('limit', String(params?.limit ?? contactsPageSize));
      q.set('offset', String(params?.offset ?? contactsOffset));
      const r = await call(`${apiBase}/marketing/brevo/contacts?${q.toString()}`, { method: 'GET' });
      setContacts(r?.items || []);
      setContactsTotal(Number(r?.total || 0));
    } catch (e: any) {
      setContactsError(
        e?.message ||
          tt(
            'admin.marketing.err.fetchContacts',
            'Cannot fetch contacts. Ensure /[tenantId]/app/api/marketing/brevo/contacts exists.',
          ),
      );
      setContacts([]);
      setContactsTotal(0);
    } finally {
      setContactsBusy(false);
    }
  }

  // Auto cargar contactos al abrir el tab
  useEffect(() => {
    if (hasAuth && mainTab === 'contacts') {
      fetchContacts({
        search: contactsSearch,
        status: contactsStatus,
        limit: contactsPageSize,
        offset: contactsOffset,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAuth, mainTab, contactsPageSize, contactsOffset, apiBase]);

  function onContactsSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setContactsOffset(0);
    fetchContacts({ search: contactsSearch, status: contactsStatus, limit: contactsPageSize, offset: 0 });
  }

  function onContactsExportCSV() {
    // Export sencillo en cliente
    const header = ['email', 'firstName', 'lastName', 'status', 'lists', 'createdAt'];
    const rows = contacts.map((c) => [
      c.email || '',
      c.firstName || '',
      c.lastName || '',
      c.status || '',
      (c.lists || []).map((l) => l.name).join('; '),
      c.createdAt || '',
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'brevo_contacts.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // Si alguien entra sin tenant (ej. /app/admin/marketing), muestra aviso claro:
  const isInvalidTenant = apiBase.startsWith('/invalid-tenant/');
  if (isInvalidTenant) {
    return (
      <main className="container py-4">
        <div className="alert alert-danger">
          Esta página requiere un <code>tenantId</code> en la URL.<br />
          Usa la ruta: <code>/{'{tenantId}'}/app/admin/marketing</code> (ej. <code>/vale/app/admin/marketing</code>).
        </div>
      </main>
    );
  }

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="marketing">
          <main className="container py-4">
            {/* Header acciones generales */}
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h1 className="h4 m-0">{tt('admin.marketing.title', 'Marketing (Brevo)')}</h1>
              <div className="d-flex flex-wrap gap-2 align-items-center">
                <div className="form-check form-switch me-2">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    id="incAll"
                    checked={includeAllCustomers}
                    onChange={(e) => setIncludeAllCustomers(e.target.checked)}
                  />
                  <label className="form-check-label small" htmlFor="incAll">
                    {tt('admin.marketing.includeAll', 'Include all customers')}
                  </label>
                </div>
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={onSetup}
                  disabled={!hasAuth || busy}
                >
                  {tt('admin.marketing.btn.setup', 'Setup')}
                </button>
                <button
                  className="btn btn-outline-primary btn-sm"
                  onClick={onSyncCustomers}
                  disabled={!hasAuth || busy}
                >
                  {tt('admin.marketing.btn.syncCustomers', 'Sync customers')}
                </button>
                <button
                  className="btn btn-outline-primary btn-sm"
                  onClick={onSyncAuthUsers}
                  disabled={!hasAuth || busy}
                >
                  {tt('admin.marketing.btn.syncAuth', 'Sync Auth users')}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={onSyncAll}
                  disabled={!hasAuth || busy}
                >
                  {tt('admin.marketing.btn.syncAll', 'Sync ALL')}
                </button>
              </div>
            </div>

            {/* Tabs principales */}
            <ul className="nav nav-tabs mb-3">
              <li className="nav-item">
                <button
                  className={`nav-link ${mainTab === 'compose' ? 'active' : ''}`}
                  onClick={() => setMainTab('compose')}
                >
                  {tt('admin.marketing.tabs.compose', 'Compose')}
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${mainTab === 'campaigns' ? 'active' : ''}`}
                  onClick={() => setMainTab('campaigns')}
                >
                  {tt('admin.marketing.tabs.campaigns', 'Campaigns')}
                </button>
              </li>
              <li className="nav-item">
                <button
                  className={`nav-link ${mainTab === 'contacts' ? 'active' : ''}`}
                  onClick={() => setMainTab('contacts')}
                >
                  {tt('admin.marketing.tabs.contacts', 'Contacts')}
                </button>
              </li>
            </ul>

            {/* === Tab: Compose === */}
            {mainTab === 'compose' && (
              <div className="card mb-4">
                <div className="card-header d-flex align-items-center justify-content-between">
                  <span>{tt('admin.marketing.compose.title', 'New campaign')}</span>
                  <div className="d-flex align-items-center gap-3">
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        id="assist"
                        checked={showAssist}
                        onChange={(e) => setShowAssist(e.target.checked)}
                      />
                      <label className="form-check-label small" htmlFor="assist">
                        {tt('admin.marketing.compose.assistant', 'Content Assistant')}
                      </label>
                    </div>
                    <div className="btn-group btn-group-sm" role="group" aria-label="Editor mode">
                      <button
                        className={`btn ${editorMode === 'visual' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setEditorMode('visual')}
                      >
                        {tt('admin.marketing.compose.mode.visual', 'Visual')}
                      </button>
                      <button
                        className={`btn ${editorMode === 'html' ? 'btn-primary' : 'btn-outline-primary'}`}
                        onClick={() => setEditorMode('html')}
                      >
                        {tt('admin.marketing.compose.mode.html', 'HTML (advanced)')}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="card-body">
                  {/* Assistant bar */}
                  {showAssist && (
                    <div className="mb-3">
                      <ul className="nav nav-pills small">
                        <li className="nav-item">
                          <button
                            className={`nav-link ${activeTab === 'templates' ? 'active' : ''}`}
                            onClick={() => setActiveTab('templates')}
                          >
                            {tt('admin.marketing.compose.tabs.templates', 'Templates')}
                          </button>
                        </li>
                        <li className="nav-item">
                          <button
                            className={`nav-link ${activeTab === 'snippets' ? 'active' : ''}`}
                            onClick={() => setActiveTab('snippets')}
                          >
                            {tt('admin.marketing.compose.tabs.snippets', 'Snippets')}
                          </button>
                        </li>
                        <li className="nav-item">
                          <button
                            className={`nav-link ${activeTab === 'checklist' ? 'active' : ''}`}
                            onClick={() => setActiveTab('checklist')}
                          >
                            {tt('admin.marketing.compose.tabs.checklist', 'Checklist')}
                          </button>
                        </li>
                        <li className="nav-item">
                          <button
                            className={`nav-link ${activeTab === 'preview' ? 'active' : ''}`}
                            onClick={() => setActiveTab('preview')}
                          >
                            {tt('admin.marketing.compose.tabs.preview', 'Preview')}
                          </button>
                        </li>
                      </ul>
                      <div className="border rounded p-3 mt-2">
                        {activeTab === 'templates' && (
                          <div className="row g-2">
                            {templates.map((t) => (
                              <div className="col-12 col-md-6 col-lg-3" key={t.name}>
                                <button
                                  className="btn btn-light w-100 text-start border"
                                  onClick={() => applyTemplate(t)}
                                >
                                  <div className="fw-semibold">{t.name}</div>
                                  <div className="text-muted small">
                                    {t.subject.slice(0, 48)}
                                    {t.subject.length > 48 ? '…' : ''}
                                  </div>
                                </button>
                              </div>
                            ))}
                            <div className="col-12 mt-2 d-flex gap-2">
                              <button
                                className="btn btn-outline-secondary btn-sm"
                                onClick={inspireSubject}
                              >
                                {tt('admin.marketing.compose.inspire', 'Inspire me (Subject)')}
                              </button>
                              <button
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => insertSnippet(snippetHero)}
                              >
                                + {tt('admin.marketing.compose.snippet.hero', 'Hero')}
                              </button>
                              <button
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => insertSnippet(snippetTwoCols)}
                              >
                                + {tt('admin.marketing.compose.snippet.twoCols', 'Two Columns')}
                              </button>
                            </div>
                          </div>
                        )}
                        {activeTab === 'snippets' && (
                          <>
                            <div className="d-flex flex-wrap gap-2 mb-3">
                              <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => insertSnippet(snippetHero)}
                              >
                                + {tt('admin.marketing.compose.snippet.hero', 'Hero')}
                              </button>
                              <button
                                className="btn btn-outline-primary btn-sm"
                                onClick={() => insertSnippet(snippetTwoCols)}
                              >
                                + {tt('admin.marketing.compose.snippet.twoCols', 'Two Columns')}
                              </button>
                            </div>
                            {/* Images */}
                            <div className="border rounded p-3 mb-3">
                              <div className="d-flex flex-wrap align-items-center gap-2">
                                <label className="fw-semibold me-2">
                                  {tt('admin.marketing.compose.images', 'Images:')}
                                </label>
                                <input
                                  ref={fileInputRef}
                                  type="file"
                                  accept="image/*"
                                  className="d-none"
                                  onChange={onFileSelected}
                                />
                                <button
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={onPickFile}
                                  disabled={uploadingImage}
                                >
                                  {uploadingImage
                                    ? tt('admin.marketing.compose.uploading', 'Uploading…')
                                    : tt('admin.marketing.compose.uploadImage', 'Upload image')}
                                </button>
                                <button
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={insertImageByUrl}
                                >
                                  {tt('admin.marketing.compose.insertByUrl', 'Insert by URL')}
                                </button>
                                <span className="text-muted small">
                                  {tt('admin.marketing.compose.storageNote', 'Stored in Firebase Storage.')}
                                </span>
                              </div>
                            </div>
                            {/* Button builder */}
                            <div className="border rounded p-3">
                              <div className="fw-semibold mb-2">
                                {tt('admin.marketing.compose.ctaBuilder', 'CTA Button builder')}
                              </div>
                              <div className="row g-2">
                                <div className="col-12 col-md-6">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.label', 'Label')}
                                  </label>
                                  <input
                                    className="form-control form-control-sm"
                                    value={btnLabel}
                                    onChange={(e) => setBtnLabel(e.target.value)}
                                  />
                                </div>
                                <div className="col-6 col-md-3">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.emoji', 'Emoji')}
                                  </label>
                                  <input
                                    className="form-control form-control-sm"
                                    value={btnEmoji}
                                    onChange={(e) => setBtnEmoji(e.target.value)}
                                    placeholder="🍔🔥⭐"
                                  />
                                </div>
                                <div className="col-12 col-md-6">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.link', 'Link (https://)')}
                                  </label>
                                  <input
                                    className="form-control form-control-sm"
                                    value={btnHref}
                                    onChange={(e) => setBtnHref(e.target.value)}
                                  />
                                </div>
                                <div className="col-6 col-md-3">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.bg', 'Background')}
                                  </label>
                                  <input
                                    type="color"
                                    className="form-control form-control-sm form-control-color"
                                    value={btnBg}
                                    onChange={(e) => setBtnBg(e.target.value)}
                                  />
                                </div>
                                <div className="col-6 col-md-3">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.text', 'Text')}
                                  </label>
                                  <input
                                    type="color"
                                    className="form-control form-control-sm form-control-color"
                                    value={btnFg}
                                    onChange={(e) => setBtnFg(e.target.value)}
                                  />
                                </div>
                                <div className="col-6 col-md-3">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.radius', 'Radius')}
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={32}
                                    className="form-control form-control-sm"
                                    value={btnRadius}
                                    onChange={(e) => setBtnRadius(Number(e.target.value) || 0)}
                                  />
                                </div>
                                <div className="col-6 col-md-3">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.size', 'Size')}
                                  </label>
                                  <select
                                    className="form-select form-select-sm"
                                    value={btnSize}
                                    onChange={(e) => setBtnSize(e.target.value as any)}
                                  >
                                    <option value="sm">
                                      {tt('admin.marketing.compose.cta.size.sm', 'Small')}
                                    </option>
                                    <option value="md">
                                      {tt('admin.marketing.compose.cta.size.md', 'Medium')}
                                    </option>
                                    <option value="lg">
                                      {tt('admin.marketing.compose.cta.size.lg', 'Large')}
                                    </option>
                                  </select>
                                </div>
                                <div className="col-6 col-md-3">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.py', 'Padding Y')}
                                  </label>
                                  <input
                                    type="number"
                                    min={4}
                                    max={40}
                                    className="form-control form-control-sm"
                                    value={btnPaddingY}
                                    onChange={(e) => setBtnPaddingY(Number(e.target.value) || 12)}
                                  />
                                </div>
                                <div className="col-6 col-md-3">
                                  <label className="form-label form-label-sm">
                                    {tt('admin.marketing.compose.cta.px', 'Padding X')}
                                  </label>
                                  <input
                                    type="number"
                                    min={8}
                                    max={48}
                                    className="form-control form-control-sm"
                                    value={btnPaddingX}
                                    onChange={(e) => setBtnPaddingX(Number(e.target.value) || 18)}
                                  />
                                </div>
                                <div className="col-12 d-flex flex-wrap align-items-center gap-2">
                                  <span className="small text-muted me-1">
                                    {tt('admin.marketing.compose.cta.presets', 'Presets:')}
                                  </span>
                                  <button
                                    className="btn btn-outline-primary btn-sm"
                                    onClick={() => setPreset('primary')}
                                  >
                                    {tt('admin.marketing.compose.cta.preset.primary', 'Primary')}
                                  </button>
                                  <button
                                    className="btn btn-outline-success btn-sm"
                                    onClick={() => setPreset('success')}
                                  >
                                    {tt('admin.marketing.compose.cta.preset.success', 'Success')}
                                  </button>
                                  <button
                                    className="btn btn-outline-danger btn-sm"
                                    onClick={() => setPreset('danger')}
                                  >
                                    {tt('admin.marketing.compose.cta.preset.danger', 'Danger')}
                                  </button>
                                  <button
                                    className="btn btn-outline-dark btn-sm"
                                    onClick={() => setPreset('dark')}
                                  >
                                    {tt('admin.marketing.compose.cta.preset.dark', 'Dark')}
                                  </button>
                                  <button
                                    className="btn btn-primary btn-sm ms-auto"
                                    onClick={insertBuiltButton}
                                  >
                                    {tt('admin.marketing.compose.cta.insert', 'Insert button')}
                                  </button>
                                </div>
                                <div className="col-12">
                                  <div className="mt-2">
                                    <div className="small text-muted mb-1">
                                      {tt('admin.marketing.compose.cta.preview', 'Preview:')}
                                    </div>
                                    <div dangerouslySetInnerHTML={{ __html: buttonHtml() }} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                        {activeTab === 'checklist' && (
                          <div className="row">
                            <div className="col-12 col-md-6">
                              <div className="fw-semibold mb-2">
                                {tt('admin.marketing.checklist.subjectQuality', 'Subject quality')}
                              </div>
                              <SubjectTip
                                ok={subjectLen > 0 && subjectLen <= 55}
                                text={tt('admin.marketing.checklist.length', 'Length ≤ 55 ({n})', {
                                  n: subjectLen,
                                })}
                              />
                              <SubjectTip
                                ok={subjectHasVerb}
                                text={tt(
                                  'admin.marketing.checklist.hasVerb',
                                  'Has action verb (order / get / try / claim…)',
                                )}
                              />
                              <SubjectTip
                                ok={!usesSpammyWords}
                                text={tt('admin.marketing.checklist.noSpam', 'Avoids spammy words')}
                              />
                            </div>
                            <div className="col-12 col-md-6">
                              <div className="fw-semibold mb-2">
                                {tt('admin.marketing.checklist.body', 'Email body')}
                              </div>
                              <SubjectTip
                                ok={hasCTAButton}
                                text={tt('admin.marketing.checklist.cta', 'Clear CTA button present')}
                              />
                              <SubjectTip
                                ok={hasImgAlt}
                                text={tt('admin.marketing.checklist.alt', 'Images have ALT (or none used)')}
                              />
                              <SubjectTip
                                ok={hasBranding}
                                text={tt('admin.marketing.checklist.branding', 'Branding/footer present')}
                              />
                            </div>
                          </div>
                        )}
                        {activeTab === 'preview' && (
                          <div className="row g-3">
                            <div className="col-12 col-lg-6">
                              <div className="fw-semibold mb-2">
                                {tt('admin.marketing.preview.inbox', 'Inbox preview')}
                              </div>
                              <div className="border rounded p-3">
                                <div className="small text-muted">
                                  {tt('admin.marketing.preview.from', 'From')}: Your Brand
                                </div>
                                <div className="fw-semibold">
                                  {subject || <span className="text-muted">[Subject]</span>}
                                </div>
                                <div className="text-muted small">{inboxPreview || ' '}</div>
                                <div className="mt-2">
                                  <label className="form-label small">
                                    {tt('admin.marketing.preview.teaserLabel', 'Preview text (optional)')}
                                  </label>
                                  <input
                                    className="form-control form-control-sm"
                                    value={previewText}
                                    onChange={(e) => setPreviewText(e.target.value)}
                                    placeholder={tt(
                                      'admin.marketing.preview.teaserPh',
                                      'Short teaser that appears next to subject',
                                    )}
                                  />
                                </div>
                              </div>
                            </div>
                            <div className="col-12 col-lg-6">
                              <div className="fw-semibold mb-2">
                                {tt('admin.marketing.preview.email', 'Email preview')}
                              </div>
                              <div
                                className="border rounded p-3"
                                style={{ maxHeight: 380, overflow: 'auto', background: '#fff' }}
                              >
                                <div dangerouslySetInnerHTML={{ __html: html }} />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Subject */}
                  <div className="mb-3">
                    <label className="form-label">{tt('admin.marketing.subject.label', 'Subject')}</label>
                    <div className="input-group">
                      <input
                        className="form-control"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        placeholder={tt('admin.marketing.subject.ph', 'E.g. Weekend promotions')}
                      />
                      <span
                        className={`input-group-text ${
                          subjectLen <= 55 && subjectLen > 0 ? 'text-success' : 'text-muted'
                        }`}
                      >
                        {subjectLen}/55
                      </span>
                    </div>
                  </div>

                  {/* Toolbar (visual) */}
                  {editorMode === 'visual' && (
                    <div className="mb-2 d-flex flex-wrap gap-2">
                      <button className="btn btn-light border btn-sm" type="button" onClick={() => exec('bold')}>
                        <strong>B</strong>
                      </button>
                      <button className="btn btn-light border btn-sm" type="button" onClick={() => exec('italic')}>
                        <em>I</em>
                      </button>
                      <button className="btn btn-light border btn-sm" type="button" onClick={() => exec('formatBlock', 'H1')}>
                        H1
                      </button>
                      <button className="btn btn-light border btn-sm" type="button" onClick={() => exec('formatBlock', 'H2')}>
                        H2
                      </button>
                      <button className="btn btn-light border btn-sm" type="button" onClick={() => exec('insertUnorderedList')}>
                        • {tt('admin.marketing.toolbar.list', 'List')}
                      </button>
                      <button
                        className="btn btn-light border btn-sm"
                        type="button"
                        onClick={() => {
                          const url = prompt(tt('admin.marketing.prompt.linkUrl', 'Link URL:')) || '';
                          if (url) exec('createLink', url);
                        }}
                      >
                        {tt('admin.marketing.toolbar.link', 'Link')}
                      </button>
                      <button
                        className="btn btn-light border btn-sm"
                        type="button"
                        onClick={onPickFile}
                        disabled={uploadingImage}
                      >
                        {uploadingImage
                          ? tt('admin.marketing.compose.uploading', 'Uploading…')
                          : tt('admin.marketing.toolbar.image', 'Image')}
                      </button>
                    </div>
                  )}

                  {/* Visual / HTML editors */}
                  {editorMode === 'visual' ? (
                    <div
                      className="form-control"
                      style={{ minHeight: 220, overflow: 'auto' }}
                      contentEditable
                      suppressContentEditableWarning
                      ref={visualRef}
                      onInput={onVisualInput}
                      onPaste={onVisualPaste}
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ) : (
                    <textarea
                      className="form-control"
                      rows={12}
                      value={html}
                      onChange={(e) => setHtml(e.target.value)}
                    />
                  )}

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="d-none"
                    onChange={onFileSelected}
                  />

                  <div className="d-flex gap-2 mt-3">
                    <button
                      className="btn btn-success"
                      onClick={onCreateCampaign}
                      disabled={!hasAuth || busy || !subject || !html}
                    >
                      {tt('admin.marketing.btn.createCampaign', 'Create campaign')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* === Tab: Campaigns === */}
            {mainTab === 'campaigns' && (
              <div className="card">
                <div className="card-header">
                  {tt('admin.marketing.campaigns.title', 'Recent campaigns')}
                </div>
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-12 col-md-6">
                      <label className="form-label">
                        {tt('admin.marketing.campaigns.testTo', 'Send test to')}
                      </label>
                      <div className="input-group">
                        <input
                          className="form-control"
                          placeholder="correo@ejemplo.com"
                          value={testEmail}
                          onChange={(e) => setTestEmail(e.target.value)}
                        />
                        <span className="input-group-text">@</span>
                      </div>
                    </div>
                  </div>
                  <div className="table-responsive mt-3">
                    <table className="table table-sm align-middle">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>{tt('admin.marketing.campaigns.name', 'Name')}</th>
                          <th>{tt('admin.marketing.campaigns.subject', 'Subject')}</th>
                          <th>{tt('admin.marketing.campaigns.status', 'Status')}</th>
                          <th>{tt('admin.marketing.campaigns.actions', 'Actions')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {campaigns.length === 0 && (
                          <tr>
                            <td colSpan={5} className="text-muted">
                              {tt('admin.marketing.campaigns.empty', 'No campaigns…')}
                            </td>
                          </tr>
                        )}
                        {campaigns.map((c: any) => (
                          <tr key={c.id}>
                            <td>{c.id}</td>
                            <td>{c.name}</td>
                            <td>{c.subject}</td>
                            <td>{c.status}</td>
                            <td className="d-flex gap-2">
                              <button
                                className="btn btn-outline-secondary btn-sm"
                                onClick={() => onSendTest(c.id)}
                                disabled={!hasAuth || busy || !testEmail}
                              >
                                {tt('admin.marketing.campaigns.test', 'Test')}
                              </button>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => onSendNow(c.id)}
                                disabled={!hasAuth || busy}
                              >
                                {tt('admin.marketing.campaigns.sendNow', 'Send now')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* === Tab: Contacts === */}
            {mainTab === 'contacts' && (
              <div className="card">
                <div className="card-header d-flex align-items-center justify-content-between">
                  <span>{tt('admin.marketing.contacts.title', 'Brevo Contacts')}</span>
                  <div className="d-flex gap-2">
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() =>
                        fetchContacts({
                          search: contactsSearch,
                          status: contactsStatus,
                          limit: contactsPageSize,
                          offset: contactsOffset,
                        })
                      }
                      disabled={!hasAuth || contactsBusy}
                    >
                      {tt('admin.marketing.contacts.refresh', 'Refresh')}
                    </button>
                    <button
                      className="btn btn-outline-primary btn-sm"
                      onClick={onContactsExportCSV}
                      disabled={contactsBusy || contacts.length === 0}
                    >
                      {tt('admin.marketing.contacts.exportCsv', 'Export CSV')}
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  <form className="row g-2 align-items-end" onSubmit={onContactsSearchSubmit}>
                    <div className="col-12 col-md-5">
                      <label className="form-label">
                        {tt('admin.marketing.contacts.searchLabel', 'Search')}
                      </label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.marketing.contacts.searchPh', 'email, name, tag…')}
                        value={contactsSearch}
                        onChange={(e) => setContactsSearch(e.target.value)}
                      />
                    </div>
                    <div className="col-6 col-md-3">
                      <label className="form-label">
                        {tt('admin.marketing.contacts.statusLabel', 'Status')}
                      </label>
                      <select
                        className="form-select"
                        value={contactsStatus}
                        onChange={(e) => {
                          setContactsStatus(e.target.value as any);
                        }}
                      >
                        <option value="all">{tt('admin.marketing.contacts.status.all', 'All')}</option>
                        <option value="subscribed">
                          {tt('admin.marketing.contacts.status.subscribed', 'Subscribed')}
                        </option>
                        <option value="unsubscribed">
                          {tt('admin.marketing.contacts.status.unsubscribed', 'Unsubscribed')}
                        </option>
                        <option value="blacklisted">
                          {tt('admin.marketing.contacts.status.blacklisted', 'Blacklisted')}
                        </option>
                      </select>
                    </div>
                    <div className="col-6 col-md-2">
                      <label className="form-label">
                        {tt('admin.marketing.contacts.pageSize', 'Page size')}
                      </label>
                      <select
                        className="form-select"
                        value={contactsPageSize}
                        onChange={(e) => setContactsPageSize(Number(e.target.value) || 25)}
                      >
                        <option>10</option>
                        <option>25</option>
                        <option>50</option>
                        <option>100</option>
                      </select>
                    </div>
                    <div className="col-12 col-md-2 d-grid">
                      <button className="btn btn-primary" type="submit" disabled={contactsBusy}>
                        {tt('admin.marketing.contacts.searchBtn', 'Search')}
                      </button>
                    </div>
                  </form>

                  {contactsError && (
                    <div className="alert alert-warning mt-3">
                      {contactsError} <br />
                      <small className="text-muted">
                        {tt(
                          'admin.marketing.contacts.tip',
                          'Tip: Implement GET /[tenantId]/app/api/marketing/brevo/contacts to return contacts from Brevo.',
                        )}
                      </small>
                    </div>
                  )}

                  <div className="d-flex justify-content-between align-items-center mt-3">
                    <div className="text-muted small">
                      {contactsTotal} {tt('admin.marketing.contacts.count', 'contacts')}
                    </div>
                    <div className="btn-group">
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        disabled={contactsBusy || contactsOffset <= 0}
                        onClick={() => {
                          const next = Math.max(0, contactsOffset - contactsPageSize);
                          setContactsOffset(next);
                        }}
                      >
                        ◀ {tt('admin.marketing.contacts.prev', 'Prev')}
                      </button>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        disabled={contactsBusy || contactsOffset + contactsPageSize >= contactsTotal}
                        onClick={() => {
                          const next = contactsOffset + contactsPageSize;
                          setContactsOffset(next);
                        }}
                      >
                        {tt('admin.marketing.contacts.next', 'Next')} ▶
                      </button>
                    </div>
                  </div>

                  <div className="table-responsive mt-2">
                    <table className="table table-sm align-middle">
                      <thead>
                        <tr>
                          <th>Email</th>
                          <th>{tt('admin.marketing.contacts.name', 'Name')}</th>
                          <th>{tt('admin.marketing.contacts.status', 'Status')}</th>
                          <th>{tt('admin.marketing.contacts.lists', 'Lists')}</th>
                          <th>{tt('admin.marketing.contacts.created', 'Created')}</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {contactsBusy && (
                          <tr>
                            <td colSpan={6} className="text-muted">
                              {tt('admin.marketing.contacts.loading', 'Loading…')}
                            </td>
                          </tr>
                        )}
                        {!contactsBusy && contacts.length === 0 && (
                          <tr>
                            <td colSpan={6} className="text-muted">
                              {tt('admin.marketing.contacts.empty', 'No contacts…')}
                            </td>
                          </tr>
                        )}
                        {!contactsBusy &&
                          contacts.map((c) => (
                            <tr key={String(c.id)}>
                              <td>{c.email}</td>
                              <td>
                                {[c.firstName, c.lastName].filter(Boolean).join(' ') || (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                              <td>
                                <span
                                  className={`badge ${
                                    c.status === 'subscribed'
                                      ? 'bg-success-subtle text-success'
                                      : c.status === 'blacklisted'
                                      ? 'bg-danger-subtle text-danger'
                                      : c.status === 'unsubscribed'
                                      ? 'bg-secondary-subtle text-secondary'
                                      : 'bg-light text-muted border'
                                  }`}
                                >
                                  {c.status || '—'}
                                </span>
                              </td>
                              <td className="small text-muted">
                                {(c.lists || []).map((l) => l.name).join(', ') || '—'}
                              </td>
                              <td className="small text-muted">
                                {c.createdAt ? new Date(c.createdAt).toLocaleString() : '—'}
                              </td>
                              <td className="text-end">
                                <button
                                  className="btn btn-outline-secondary btn-sm"
                                  onClick={() => setSelectedContact(c)}
                                >
                                  {tt('admin.marketing.contacts.view', 'View')}
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Modal contacto */}
            {selectedContact && (
              <div className="modal d-block" tabIndex={-1} role="dialog" onClick={() => setSelectedContact(null)}>
                <div className="modal-dialog modal-lg" role="document" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-content">
                    <div className="modal-header">
                      <h5 className="modal-title">
                        {tt('admin.marketing.contactModal.title', 'Contact')}
                      </h5>
                      <button type="button" className="btn-close" onClick={() => setSelectedContact(null)} />
                    </div>
                    <div className="modal-body">
                      <dl className="row">
                        <dt className="col-sm-3">Email</dt>
                        <dd className="col-sm-9">{selectedContact.email}</dd>
                        <dt className="col-sm-3">
                          {tt('admin.marketing.contactModal.name', 'Name')}
                        </dt>
                        <dd className="col-sm-9">
                          {[selectedContact.firstName, selectedContact.lastName].filter(Boolean).join(' ') || '—'}
                        </dd>
                        <dt className="col-sm-3">
                          {tt('admin.marketing.contactModal.status', 'Status')}
                        </dt>
                        <dd className="col-sm-9">{selectedContact.status || '—'}</dd>
                        <dt className="col-sm-3">
                          {tt('admin.marketing.contactModal.lists', 'Lists')}
                        </dt>
                        <dd className="col-sm-9">
                          {(selectedContact.lists || []).map((l) => l.name).join(', ') || '—'}
                        </dd>
                        <dt className="col-sm-3">
                          {tt('admin.marketing.contactModal.created', 'Created')}
                        </dt>
                        <dd className="col-sm-9">
                          {selectedContact.createdAt ? new Date(selectedContact.createdAt).toLocaleString() : '—'}
                        </dd>
                        <dt className="col-sm-3">
                          {tt('admin.marketing.contactModal.tags', 'Tags')}
                        </dt>
                        <dd className="col-sm-9">{(selectedContact.tags || []).join(', ') || '—'}</dd>
                        <dt className="col-sm-3">
                          {tt('admin.marketing.contactModal.attributes', 'Attributes')}
                        </dt>
                        <dd className="col-sm-9">
                          <pre
                            className="small bg-light p-2 rounded"
                            style={{ maxHeight: 220, overflow: 'auto' }}
                          >
                            {JSON.stringify(selectedContact.attributes || {}, null, 2)}
                          </pre>
                        </dd>
                      </dl>
                    </div>
                    <div className="modal-footer">
                      <button className="btn btn-secondary" onClick={() => setSelectedContact(null)}>
                        {tt('admin.marketing.contactModal.close', 'Close')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Log */}
            <div className="mt-4">
              <h2 className="h6">{tt('admin.marketing.log.title', 'Log')}</h2>
              <pre className="bg-light p-3 rounded small" style={{ maxHeight: 200, overflow: 'auto' }}>
                {log.join('\n') || '...'}
              </pre>
            </div>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}

// ✅ Default export requerido por Next.js en /page.tsx
export default function AdminMarketingPage() {
  return <AdminMarketingPage_Inner />;
}
