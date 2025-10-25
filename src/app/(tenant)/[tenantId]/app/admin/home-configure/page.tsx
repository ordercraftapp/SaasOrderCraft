'use client';
import { getAuth } from 'firebase/auth';
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import { OnlyAdmin } from '@/app/(tenant)/[tenantId]/components/Only';
import ToolGate from '@/components/ToolGate';
import '@/lib/firebase/client';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
  query,
} from 'firebase/firestore';

import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from 'firebase/storage';

/* ===========================================================
   Tipos locales
   =========================================================== */

type TimestampLike = any;

type HeroSlide = {
  imageUrl: string;
  imageAlt?: string;
  headline: string;
  sub?: string;
  cta?: { label?: string; href?: string };
  overlay?: 'dark' | 'light' | 'none';
};

type HeroVideo = {
  url: string;
  posterUrl?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
};

type PromoEntry = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  imageUrl?: string;
  discountPct?: number;
  startAt?: TimestampLike;
  endAt?: TimestampLike;
  active: boolean;
  menuItemIds?: string[];
  couponIds?: string[];
};

type FeaturedMenuItem = {
  menuItemId: string;
  name: string;
  price: number;
  imageUrl?: string;
  tags?: string[];
};

/* === Contact & Newsletter (normalizado) === */
type ContactBranch = {
  branchId: string;
  branchName?: string;
  address?: string;
  phone?: string;
  email?: string;
  webpage?: string;
};

type HomeConfig = {
  updatedAt?: TimestampLike;
  hero: {
    variant: 'image' | 'carousel' | 'video';
    slides?: HeroSlide[];
    video?: HeroVideo;
  };
  promos: PromoEntry[];
  featuredMenu: {
    title?: string;
    categoryIds?: string[];
    subcategoryIds?: string[];
    itemIds?: string[];
    items: FeaturedMenuItem[];
  };
  gallery: { images: Array<{ url: string; alt?: string }> };
  seo?: { title?: string; description?: string; ogImage?: string; keywords?: string[] };

  aboutUs?: { title?: string; text?: string; imageUrl?: string };

  newsletter?: {
    title?: string;
    text?: string;
    placeholderEmail?: string;
    buttonLabel?: string;
    successMsg?: string;
    errorMsg?: string;
  };

  contact?: { title?: string; text?: string; branches?: ContactBranch[] };

  publish: { status: 'draft' | 'published'; version: number };
};

/* ===========================================================
   Utils
   =========================================================== */

function getTenantFromParams(p: Record<string, string | string[] | undefined>) {
  const candidate = (p.tenantId ?? p.tenant) as string | undefined;
  return candidate ?? '';
}

async function compressImageFile(
  file: File,
  opts: { maxW: number; maxH: number; quality: number }
) {
  const { maxW, maxH, quality } = opts;
  const bmp = await createImageBitmap(file);
  const ratio = Math.min(maxW / bmp.width, maxH / bmp.height, 1);
  const w = Math.round(bmp.width * ratio);
  const h = Math.round(bmp.height * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context');
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/jpeg', quality));
  if (!blob) throw new Error('No blob produced');
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

async function uploadToStorage(path: string, file: File): Promise<string> {
  const storage = getStorage();
  const ref = storageRef(storage, path);
  // ✅ fuerza contentType y buen cacheado para imágenes/videos públicos
  const meta = {
    contentType: file.type || (file.name.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'),
    cacheControl: 'public, max-age=31536000, immutable',
  };
  await uploadBytes(ref, file, meta as any);
  return getDownloadURL(ref);
}

/* === YouTube helpers === */
function ytId(u: string) {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    if (url.searchParams.get('v')) return url.searchParams.get('v')!;
    const parts = url.pathname.split('/');
    const i = parts.indexOf('embed');
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch {}
  return null;
}
function buildYtEmbedUrl(id: string, opts: { autoplay?: boolean; muted?: boolean; loop?: boolean }) {
  const ap = opts.autoplay ? 1 : 0;
  const mu = opts.autoplay ? 1 : (opts.muted ? 1 : 0);
  const params = new URLSearchParams({
    rel: '0', modestbranding: '1', controls: '1', playsinline: '1',
    autoplay: String(ap), mute: String(mu),
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}
function maybeNormalizeYouTubeUrl(raw: string, opts: { autoplay?: boolean; muted?: boolean; loop?: boolean }) {
  const id = ytId(raw);
  return id ? buildYtEmbedUrl(id, opts) : raw;
}

/* ===========================================================
   Cargas base (tenant-scoped)
   =========================================================== */

type Category = { id: string; name: string };
type Subcategory = { id: string; name: string; categoryId?: string };
type MenuItem = { id: string; name: string; price?: number; imageUrl?: string; categoryId?: string; subcategoryId?: string };
type Coupon = { id: string; code: string; label?: string; discountPct?: number; active?: boolean };

async function fetchCategories(tenantId: string): Promise<Category[]> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, `tenants/${tenantId}/categories`));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
async function fetchSubcategories(tenantId: string): Promise<Subcategory[]> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, `tenants/${tenantId}/subcategories`));
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
async function fetchMenuItems(tenantId: string): Promise<MenuItem[]> {
  const db = getFirestore();
  const qy = query(collection(db, `tenants/${tenantId}/menuItems`));
  const snap = await getDocs(qy);
  return snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
/** Cupones en `tenants/{tenantId}/promotions` (solo code/label/%) */
async function fetchCoupons(tenantId: string): Promise<Coupon[]> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, `tenants/${tenantId}/promotions`));
  const list = snap.docs.map((d) => {
    const data = d.data() as any;
    const code = typeof data?.code === 'string' ? data.code : '';
    const label = typeof data?.name === 'string' ? data.name : undefined;
    const discountPct = typeof data?.value === 'number' && data?.type === 'percent' ? data.value : undefined;
    const active = typeof data?.active === 'boolean' ? data.active : undefined;
    return { id: d.id, code, label, discountPct, active } as Coupon;
  });
  return list.filter((c) => !!c.code).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
}

/* ===========================================================
   Página principal
   =========================================================== */

export default function AdminHomeConfigurePage() {
  const params = useParams();
  const tenantId = getTenantFromParams(params as any);

  // 🔤 idioma
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
    try {
      if (typeof window !== 'undefined') {
        const ls = localStorage.getItem('tenant.language');
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [cfg, setCfg] = useState<HomeConfig>({
    hero: { variant: 'image', slides: [] },
    promos: [],
    featuredMenu: { title: tt('admin.home.featured.titleDefault', 'Featured'), categoryIds: [], subcategoryIds: [], itemIds: [], items: [] },
    gallery: { images: [] },
    seo: { title: '', description: '', ogImage: '', keywords: [] },
    aboutUs: { title: '', text: '', imageUrl: '' },
    newsletter: {
      title: tt('admin.home.newsletter.titleDefault', 'Join our newsletter'),
      text: tt('admin.home.newsletter.textDefault', 'News, promos & seasonal dishes — no spam.'),
      placeholderEmail: tt('admin.home.newsletter.emailPh', 'Your email'),
      buttonLabel: tt('admin.home.newsletter.btn', 'Subscribe'),
      successMsg: tt('admin.home.newsletter.ok', 'Thanks! Check your inbox.'),
      errorMsg: tt('admin.home.newsletter.err', 'Sorry, something went wrong. Try again.'),
    },
    contact: {
      title: tt('admin.home.contact.titleDefault', 'Contact us'),
      text: tt('admin.home.contact.textDefault', 'Find us or reach out by phone/email.'),
      branches: [],
    },
    publish: { status: 'draft', version: 1 },
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [tab, setTab] = useState<'hero' | 'promos' | 'featured' | 'gallery' | 'about' | 'newsletter' | 'contact' | 'seo' | 'publish'>('hero');

  useEffect(() => {
    if (!tenantId) return;
    (async () => {
      try {
        const db = getFirestore();
        const ref = doc(db, `tenants/${tenantId}/settings/homeConfig`);
        const snap = await getDoc(ref);

        const [cats, subs, items, coups] = await Promise.all([
          fetchCategories(tenantId),
          fetchSubcategories(tenantId),
          fetchMenuItems(tenantId),
          fetchCoupons(tenantId),
        ]);

        setCategories(cats);
        setSubcategories(subs);
        setMenuItems(items);
        setCoupons(coups);

        if (snap.exists()) {
          const data = snap.data() as HomeConfig;

          data.featuredMenu = {
            title: data.featuredMenu?.title ?? tt('admin.home.featured.titleDefault', 'Featured'),
            categoryIds: data.featuredMenu?.categoryIds ?? [],
            subcategoryIds: data.featuredMenu?.subcategoryIds ?? [],
            itemIds: data.featuredMenu?.itemIds ?? [],
            items: data.featuredMenu?.items ?? [],
          };

          data.aboutUs = {
            title: data.aboutUs?.title ?? '',
            text: data.aboutUs?.text ?? '',
            imageUrl: data.aboutUs?.imageUrl ?? '',
          };

          data.newsletter = {
            title: data.newsletter?.title ?? tt('admin.home.newsletter.titleDefault', 'Join our newsletter'),
            text: data.newsletter?.text ?? tt('admin.home.newsletter.textDefault', 'News, promos & seasonal dishes — no spam.'),
            placeholderEmail: data.newsletter?.placeholderEmail ?? tt('admin.home.newsletter.emailPh', 'Your email'),
            buttonLabel: data.newsletter?.buttonLabel ?? tt('admin.home.newsletter.btn', 'Subscribe'),
            successMsg: data.newsletter?.successMsg ?? tt('admin.home.newsletter.ok', 'Thanks! Check your inbox.'),
            errorMsg: data.newsletter?.errorMsg ?? tt('admin.home.newsletter.err', 'Sorry, something went wrong. Try again.'),
          };

          const legacyBranches = (data as any)?.contact?.branches || [];
          const normalizedBranches: ContactBranch[] = Array.isArray(legacyBranches)
            ? legacyBranches.map((b: any, i: number) => {
                const firstPhone = Array.isArray(b?.phones) ? (b.phones[0] ?? '') : (typeof b?.phone === 'string' ? b.phone : '');
                const firstEmail = Array.isArray(b?.emails) ? (b.emails[0] ?? '') : (typeof b?.email === 'string' ? b.email : '');
                return {
                  branchId: b?.branchId || `${Date.now()}-${i}`,
                  branchName: b?.branchName ?? '',
                  address: b?.address ?? '',
                  phone: firstPhone ?? '',
                  email: firstEmail ?? '',
                  webpage: typeof b?.webpage === 'string' ? b.webpage : '',
                };
              })
            : [];
          data.contact = {
            title: (data as any)?.contact?.title ?? tt('admin.home.contact.titleDefault', 'Contact us'),
            text: (data as any)?.contact?.text ?? tt('admin.home.contact.textDefault', 'Find us or reach out by phone/email.'),
            branches: normalizedBranches,
          };

          setCfg(data);
        }
      } catch (e) {
        console.error('[home-configure] load error', e);
      } finally {
        setLoading(false);
      }
    })();
  }, [tenantId, tt]);

  /* ===========================
     Setters
     =========================== */

  function setHero(patch: Partial<HomeConfig['hero']>) {
    setCfg((prev) => ({ ...prev, hero: { ...prev.hero, ...patch } }));
  }
  function setHeroSlides(updater: (slides: HeroSlide[]) => HeroSlide[]) {
    setCfg((prev) => {
      const slides = Array.isArray(prev.hero.slides) ? prev.hero.slides : [];
      return { ...prev, hero: { ...prev.hero, slides: updater(slides) } };
    });
  }
  function setHeroVideo(patch: Partial<HeroVideo>) {
    setCfg((prev) => {
      const video: HeroVideo = { ...(prev.hero.video || { url: '', muted: true, autoplay: true, loop: true }), ...patch };
      return { ...prev, hero: { ...prev.hero, video } };
    });
  }

  /* ===========================
     Guardar / Publicar (tenant-scoped)
     =========================== */

  async function saveDraft() {
  if (!tenantId) return;
  setSaving(true);
  try {
    await getAuth().currentUser?.getIdToken(true); // refresca claims

    const db = getFirestore();
    const ref = doc(db, `tenants/${tenantId}/settings/homeConfig`);
    const existing = await getDoc(ref);

    const base: any = { tenantId, updatedAt: serverTimestamp() };
    if (!existing.exists()) base.createdAt = serverTimestamp();

    const next: HomeConfig = {
      ...cfg,
      ...base,
      publish: { ...(cfg.publish || { version: 1, status: 'draft' }), status: 'draft' },
    };

    await setDoc(ref, next, { merge: true });
    setCfg(next);
  } catch (e) {
    console.error('[home-configure] saveDraft error', e);
    alert(tt('admin.home.err.saveDraft', 'Error saving draft'));
  } finally {
    setSaving(false);
  }
}

async function publishNow() {
  if (!tenantId) return;
  setSaving(true);
  try {
    await getAuth().currentUser?.getIdToken(true); // refresca claims

    const db = getFirestore();
    const ref = doc(db, `tenants/${tenantId}/settings/homeConfig`);
    const existing = await getDoc(ref);

    const base: any = { tenantId, updatedAt: serverTimestamp() };
    if (!existing.exists()) base.createdAt = serverTimestamp();

    const next: HomeConfig = {
      ...cfg,
      ...base,
      publish: { version: (cfg.publish?.version || 0) + 1, status: 'published' },
    };

    await setDoc(ref, next, { merge: true });
    setCfg(next);
  } catch (e) {
    console.error('[home-configure] publish error', e);
    alert(tt('admin.home.err.publish', 'Error publishing'));
  } finally {
    setSaving(false);
  }
}


  /* ===========================
     Subidas de imágenes (prefijo por tenant)
     =========================== */

  const imgInputRef = useRef<HTMLInputElement | null>(null);
  async function handleAddHeroImage() {
    if (!tenantId) return;
    const input = imgInputRef.current;
    if (!input || !input.files?.length) return;
    const raw = input.files[0];
    const compressed = await compressImageFile(raw, { maxW: 1920, maxH: 1080, quality: 0.8 });
    const path = `tenants/${tenantId}/home/hero/${Date.now()}-${compressed.name}`;
    const url = await uploadToStorage(path, compressed);
    const newSlide: HeroSlide = {
      imageUrl: url,
      headline: tt('admin.home.hero.defaultHeadline', 'Delicious moments'),
      sub: tt('admin.home.hero.defaultSub', 'Your favorite dishes, fast & fresh.'),
      overlay: 'dark',
    };
    setHeroSlides((slides) => [...slides, newSlide]);
    input.value = '';
  }

  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  async function handleAddGalleryImage() {
    if (!tenantId) return;
    const input = galleryInputRef.current;
    if (!input || !input.files?.length) return;
    const raw = input.files[0];
    const compressed = await compressImageFile(raw, { maxW: 1600, maxH: 1200, quality: 0.8 });
    const path = `tenants/${tenantId}/home/gallery/${Date.now()}-${compressed.name}`;
    const url = await uploadToStorage(path, compressed);
    setCfg((prev) => ({
      ...prev,
      gallery: { images: [...(prev.gallery.images || []), { url, alt: tt('admin.home.gallery.imgAlt', 'Gallery image') }] },
    }));
    input.value = '';
  }

  const aboutImageInputRef = useRef<HTMLInputElement | null>(null);
  async function handleUploadAboutImage() {
    if (!tenantId) return;
    const input = aboutImageInputRef.current;
    if (!input || !input.files?.length) return;
    const raw = input.files[0];
    const compressed = await compressImageFile(raw, { maxW: 1600, maxH: 1200, quality: 0.85 });
    const path = `tenants/${tenantId}/home/about/${Date.now()}-${compressed.name}`;
    const url = await uploadToStorage(path, compressed);
    setCfg((prev) => ({ ...prev, aboutUs: { ...(prev.aboutUs || {}), imageUrl: url } }));
    input.value = '';
  }

  /* ===========================
     Video (URL o Subida) — máx 300MB
     =========================== */

  const videoInputRef = useRef<HTMLInputElement | null>(null);
  async function handleUploadVideo() {
    if (!tenantId) return;
    const input = videoInputRef.current;
    if (!input || !input.files?.length) return;
    const raw = input.files[0];
    if (!/^video\/mp4$/i.test(raw.type)) {
      alert(tt('admin.home.video.onlyMp4', 'Only MP4 is allowed'));
      return;
    }
    if (raw.size > 300 * 1024 * 1024) {
      alert(tt('admin.home.video.tooBig', 'The video exceeds 300MB. Please compress it.'));
      return;
    }
    const path = `tenants/${tenantId}/home/hero/video/${Date.now()}-${raw.name}`;
    const url = await uploadToStorage(path, raw);
    setHeroVideo({ url });
    input.value = '';
  }

  const posterInputRef = useRef<HTMLInputElement | null>(null);
  async function handleUploadPoster() {
    if (!tenantId) return;
    const input = posterInputRef.current;
    if (!input || !input.files?.length) return;
    const raw = input.files[0];
    const compressed = await compressImageFile(raw, { maxW: 1920, maxH: 1080, quality: 0.8 });
    const path = `tenants/${tenantId}/home/hero/video/posters/${Date.now()}-${compressed.name}`;
    const url = await uploadToStorage(path, compressed);
    setHeroVideo({ posterUrl: url });
    input.value = '';
  }

  /* ===========================
     Hero: variant
     =========================== */

  function onHeroVariantChange(v: 'image' | 'carousel' | 'video') {
    if (v === 'video') {
      setHero({
        variant: v,
        video: { ...(cfg.hero.video || { url: '', muted: true, autoplay: true, loop: true }) },
      });
    } else {
      setHero({ variant: v });
    }
  }

  /* ===========================
     Featured Menu: categorías, subcategorías e items
     =========================== */

  function toggleInArray<T extends string>(arr: T[] | undefined, id: T): T[] {
    const base = arr || [];
    return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
  }
  function toggleCategory(catId: string) {
    setCfg((prev) => ({
      ...prev,
      featuredMenu: { ...prev.featuredMenu, categoryIds: toggleInArray(prev.featuredMenu.categoryIds, catId) },
    }));
  }
  function toggleSubcategory(subId: string) {
    setCfg((prev) => ({
      ...prev,
      featuredMenu: { ...prev.featuredMenu, subcategoryIds: toggleInArray(prev.featuredMenu.subcategoryIds, subId) },
    }));
  }
  function toggleItem(itemId: string) {
    setCfg((prev) => ({
      ...prev,
      featuredMenu: { ...prev.featuredMenu, itemIds: toggleInArray(prev.featuredMenu.itemIds, itemId) },
    }));
  }

  /* ===========================
     Promos: platos y cupones
     =========================== */

  function addEmptyPromo() {
    const p: PromoEntry = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
      title: tt('admin.home.promos.newTitle', 'New Promo'),
      active: true,
      badge: 'warning',
      discountPct: 10,
      menuItemIds: [],
      couponIds: [],
    };
    setCfg((prev) => ({ ...prev, promos: [...prev.promos, p] }));
  }
  function updatePromo(id: string, patch: Partial<PromoEntry>) {
    setCfg((prev) => ({
      ...prev,
      promos: prev.promos.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  }
  function removePromo(id: string) {
    setCfg((prev) => ({ ...prev, promos: prev.promos.filter((p) => p.id !== id) }));
  }

  /* ===========================
     Gallery Carousel (admin preview)
     =========================== */
  const [galleryIdx, setGalleryIdx] = useState(0);
  useEffect(() => {
    const imgs = cfg.gallery.images || [];
    if (imgs.length <= 1) return;
    const t = setInterval(() => setGalleryIdx((i) => (i + 1) % imgs.length), 3000);
    return () => clearInterval(t);
  }, [cfg.gallery.images]);

  /* ===========================
     Render
     =========================== */

  if (loading) {
    return (

      <Protected>
        <OnlyAdmin>
          <ToolGate feature="homeConfigure">     
            <div className="container py-5 text-center">
              <div className="spinner-border" role="status" />
              <div className="mt-2">{tt('common.loading', 'Loading…')}</div>
            </div>
          </ToolGate>
        </OnlyAdmin>
      </Protected>
      
    );
  }

  return (
    <Protected>
      <OnlyAdmin>
        <ToolGate feature="homeConfigure">
            <div className="container py-4">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h1 className="h4 m-0">{tt('admin.home.title', 'Home Configure')}</h1>
              <div className="d-flex gap-2">
                <button className="btn btn-outline-secondary" disabled={saving} onClick={saveDraft}>
                  {saving ? tt('admin.home.btn.saving', 'Saving…') : tt('admin.home.btn.saveDraft', 'Save draft')}
                </button>
                <button className="btn btn-primary" disabled={saving} onClick={publishNow}>
                  {saving ? tt('admin.home.btn.publishing', 'Publishing…') : tt('admin.home.btn.publish', 'Publish')}
                </button>
              </div>
            </div>

            {/* Tabs */}
            <ul className="nav nav-tabs mb-3">
              {[
                { k: 'hero', label: tt('admin.home.tab.hero', 'Hero') },
                { k: 'promos', label: tt('admin.home.tab.promos', 'Promotions') },
                { k: 'featured', label: tt('admin.home.tab.featured', 'Featured Menu') },
                { k: 'gallery', label: tt('admin.home.tab.gallery', 'Gallery') },
                { k: 'about', label: tt('admin.home.tab.about', 'About Us') },
                { k: 'newsletter', label: tt('admin.home.tab.newsletter', 'Newsletter') },
                { k: 'contact', label: tt('admin.home.tab.contact', 'Contact') },
                { k: 'seo', label: tt('admin.home.tab.seo', 'SEO') },
                { k: 'publish', label: tt('admin.home.tab.publish', 'Publish') },
              ].map((t) => (
                <li className="nav-item" key={t.k}>
                  <button className={`nav-link ${tab === (t.k as any) ? 'active' : ''}`} onClick={() => setTab(t.k as any)}>
                    {t.label}
                  </button>
                </li>
              ))}
            </ul>

            {/* === HERO === */}
            {tab === 'hero' && (
              <div className="card shadow-sm">
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label">{tt('admin.home.hero.variant', 'Variant')}</label>
                      <select
                        className="form-select"
                        value={cfg.hero.variant}
                        onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                          onHeroVariantChange(e.target.value as 'image' | 'carousel' | 'video')
                        }
                      >
                        <option value="image">{tt('admin.home.hero.variant.image', 'Single image')}</option>
                        <option value="carousel">{tt('admin.home.hero.variant.carousel', 'Carousel')}</option>
                        <option value="video">{tt('admin.home.hero.variant.video', 'Video')}</option>
                      </select>
                    </div>
                  </div>

                  {(cfg.hero.variant === 'image' || cfg.hero.variant === 'carousel') && (
                    <>
                      <hr />
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <input ref={imgInputRef} type="file" accept="image/*" className="form-control" />
                        <button className="btn btn-outline-primary" onClick={handleAddHeroImage}>
                          {tt('admin.home.hero.addSlide', 'Add slide (auto-compress)')}
                        </button>
                      </div>

                      <div className="row g-3">
                        {(cfg.hero.slides || []).map((s, idx) => (
                          <div className="col-md-6" key={idx}>
                            <div className="card h-100">
                              <img src={s.imageUrl} className="card-img-top" alt={s.imageAlt || 'slide'} />
                              <div className="card-body">
                                <div className="mb-2">
                                  <label className="form-label">{tt('admin.home.hero.headline', 'Headline')}</label>
                                  <input
                                    className="form-control"
                                    value={s.headline}
                                    onChange={(e) =>
                                      setHeroSlides((slides) => {
                                        const next = [...slides];
                                        next[idx] = { ...next[idx], headline: e.target.value };
                                        return next;
                                      })
                                    }
                                  />
                                </div>
                                <div className="mb-2">
                                  <label className="form-label">{tt('admin.home.hero.subheadline', 'Subheadline')}</label>
                                  <input
                                    className="form-control"
                                    value={s.sub || ''}
                                    onChange={(e) =>
                                      setHeroSlides((slides) => {
                                        const next = [...slides];
                                        next[idx] = { ...next[idx], sub: e.target.value };
                                        return next;
                                      })
                                    }
                                  />
                                </div>
                                <div className="row g-2">
                                  <div className="col-6">
                                    <label className="form-label">{tt('admin.home.hero.ctaLabel', 'CTA label')}</label>
                                    <input
                                      className="form-control"
                                      value={s.cta?.label || ''}
                                      onChange={(e) =>
                                        setHeroSlides((slides) => {
                                          const next = [...slides];
                                          const prevSlide = next[idx] || {};
                                          const prevCta = (prevSlide as HeroSlide).cta || {};
                                          next[idx] = { ...(prevSlide as HeroSlide), cta: { ...prevCta, label: e.target.value } };
                                          return next;
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="col-6">
                                    <label className="form-label">{tt('admin.home.hero.ctaHref', 'CTA href')}</label>
                                    <input
                                      className="form-control"
                                      value={s.cta?.href || ''}
                                      onChange={(e) =>
                                        setHeroSlides((slides) => {
                                          const next = [...slides];
                                          const prevSlide = next[idx] || {};
                                          const prevCta = (prevSlide as HeroSlide).cta || {};
                                          next[idx] = { ...(prevSlide as HeroSlide), cta: { ...prevCta, href: e.target.value } };
                                          return next;
                                        })
                                      }
                                    />
                                  </div>
                                </div>
                                <div className="mt-2">
                                  <label className="form-label">{tt('admin.home.hero.overlay', 'Overlay')}</label>
                                  <select
                                    className="form-select"
                                    value={s.overlay || 'dark'}
                                    onChange={(e) =>
                                      setHeroSlides((slides) => {
                                        const next = [...slides];
                                        next[idx] = { ...next[idx], overlay: e.target.value as 'dark' | 'light' | 'none' };
                                        return next;
                                      })
                                    }
                                  >
                                    <option value="dark">{tt('admin.home.hero.overlay.dark', 'Dark')}</option>
                                    <option value="light">{tt('admin.home.hero.overlay.light', 'Light')}</option>
                                    <option value="none">{tt('admin.home.hero.overlay.none', 'None')}</option>
                                  </select>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {cfg.hero.variant === 'video' && (
                    <>
                      <hr />
                      <div className="alert alert-info">
                        {tt('admin.home.video.notice',
                          'You can use a URL (YouTube/Vimeo/MP4) or upload an MP4 (max 300MB). I recommend adding a poster for the first render.'
                        )}
                      </div>

                      <div className="row g-3">
                        <div className="col-md-6">
                          <label className="form-label">{tt('admin.home.video.url', 'Video URL')}</label>
                          <input
                            className="form-control"
                            placeholder={tt('admin.home.video.urlPh', 'https://... (mp4, youtube, vimeo)')}
                            value={cfg.hero.video?.url || ''}
                            onChange={(e) => {
                              const urlRaw = e.target.value;
                              const vopts = {
                                autoplay: !!cfg.hero.video?.autoplay,
                                muted: !!cfg.hero.video?.muted,
                                loop: !!cfg.hero.video?.loop,
                              };
                              const normalized = maybeNormalizeYouTubeUrl(urlRaw, vopts);
                              setHeroVideo({ url: normalized });
                            }}
                          />
                          <div className="small text-muted mt-1">
                            {tt('admin.home.video.embedInfo',
                              'If it is YouTube/Vimeo, we will render the embed; if it is MP4, we will use HTML5 <video>.'
                            )}
                          </div>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">{tt('admin.home.video.upload', 'Upload MP4 (max 300MB)')}</label>
                          <div className="d-flex gap-2">
                            <input ref={videoInputRef} type="file" accept="video/mp4" className="form-control" />
                            <button className="btn btn-outline-primary" onClick={handleUploadVideo}>
                              {tt('admin.home.btn.upload', 'Upload')}
                            </button>
                          </div>
                        </div>

                        <div className="col-md-6">
                          <label className="form-label">{tt('admin.home.video.poster', 'Poster (image)')}</label>
                          <div className="d-flex gap-2">
                            <input ref={posterInputRef} type="file" accept="image/*" className="form-control" />
                            <button className="btn btn-outline-primary" onClick={handleUploadPoster}>
                              {tt('admin.home.video.uploadPoster', 'Upload poster')}
                            </button>
                          </div>
                        </div>

                        <div className="col-md-6">
                          <label className="form-label">{tt('admin.home.video.playback', 'Playback')}</label>
                          <div className="row g-2">
                            <div className="col-4">
                              <div className="form-check">
                                <input
                                  id="autoplay"
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={!!cfg.hero.video?.autoplay}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const currentUrl = cfg.hero.video?.url || '';
                                    const normalized = maybeNormalizeYouTubeUrl(currentUrl, {
                                      autoplay: checked,
                                      muted: checked ? true : !!cfg.hero.video?.muted,
                                      loop: !!cfg.hero.video?.loop,
                                    });
                                    setHeroVideo({ autoplay: checked, muted: checked ? true : cfg.hero.video?.muted, url: normalized });
                                  }}
                                />
                                <label className="form-check-label" htmlFor="autoplay">
                                  {tt('admin.home.video.autoplay', 'Autoplay')}
                                </label>
                              </div>
                            </div>
                            <div className="col-4">
                              <div className="form-check">
                                <input
                                  id="loop"
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={!!cfg.hero.video?.loop}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const currentUrl = cfg.hero.video?.url || '';
                                    const normalized = maybeNormalizeYouTubeUrl(currentUrl, {
                                      autoplay: !!cfg.hero.video?.autoplay,
                                      muted: !!cfg.hero.video?.muted,
                                      loop: checked,
                                    });
                                    setHeroVideo({ loop: checked, url: normalized });
                                  }}
                                />
                                <label className="form-check-label" htmlFor="loop">
                                  {tt('admin.home.video.loop', 'Loop')}
                                </label>
                              </div>
                            </div>
                            <div className="col-4">
                              <div className="form-check">
                                <input
                                  id="muted"
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={!!cfg.hero.video?.muted}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const currentUrl = cfg.hero.video?.url || '';
                                    const normalized = maybeNormalizeYouTubeUrl(currentUrl, {
                                      autoplay: !!cfg.hero.video?.autoplay,
                                      muted: checked,
                                      loop: !!cfg.hero.video?.loop,
                                    });
                                    setHeroVideo({ muted: checked, url: normalized });
                                  }}
                                />
                                <label className="form-check-label" htmlFor="muted">
                                  {tt('admin.home.video.muted', 'Muted')}
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* === PROMOS === */}
            {tab === 'promos' && (
              <div className="card shadow-sm border-0">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h2 className="h5 m-0">{tt('admin.home.promos.title', 'Promotions')}</h2>
                      <small className="text-muted">
                        {tt('admin.home.promos.subtitle', 'Highlight your promos with images from the selected dishes.')}
                      </small>
                    </div>
                    <button className="btn btn-primary" onClick={addEmptyPromo}>
                      {tt('admin.home.promos.add', '+ Add promotion')}
                    </button>
                  </div>

                  {(cfg.promos || []).length === 0 && (
                    <div className="text-muted">{tt('admin.home.promos.empty', 'No promotions yet.')}</div>
                  )}

                  <div className="row g-3">
                    {cfg.promos.map((p) => {
                      const dishes = (p.menuItemIds || [])
                        .map((id) => menuItems.find((m) => m.id === id))
                        .filter(Boolean) as MenuItem[];

                      const selectedCoverId = dishes.find((d) => d.imageUrl && d.imageUrl === p.imageUrl)?.id || '';

                      return (
                        <div className="col-md-6" key={p.id}>
                          <div className="card h-100 shadow-sm overflow-hidden">
                            <div className="position-relative p-3 bg-gradient" style={{ background: 'linear-gradient(135deg, #ffe29f 0%, #ffa99f 48%, #ff719a 100%)' }}>
                              <span className={`badge bg-${p.badge || 'warning'} text-uppercase`}>{p.badge || 'warning'}</span>
                              <div className="form-check form-switch position-absolute top-0 end-0 m-3">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  id={`active-${p.id}`}
                                  checked={p.active}
                                  onChange={(e) => updatePromo(p.id, { active: e.target.checked })}
                                />
                                <label className="form-check-label text-dark small" htmlFor={`active-${p.id}`}>
                                  {tt('admin.home.promos.active', 'Active')}
                                </label>
                              </div>
                              <div className="mt-3 text-dark">
                                <div className="row g-2">
                                  <div className="col-8">
                                    <label className="form-label text-dark-50">{tt('common.title', 'Title')}</label>
                                    <input
                                      className="form-control form-control-lg"
                                      value={p.title}
                                      onChange={(e) => updatePromo(p.id, { title: e.target.value })}
                                    />
                                  </div>
                                  <div className="col-4">
                                    <label className="form-label text-dark-50">{tt('admin.home.promos.discountPct', 'Discount %')}</label>
                                    <input
                                      type="number"
                                      className="form-control"
                                      value={p.discountPct ?? 0}
                                      onChange={(e) => updatePromo(p.id, { discountPct: Number(e.target.value || 0) })}
                                    />
                                  </div>
                                </div>
                                <div className="mt-2">
                                  <label className="form-label text-dark-50">{tt('admin.home.promos.subtitleLabel', 'Subtitle')}</label>
                                  <input
                                    className="form-control"
                                    value={p.subtitle || ''}
                                    onChange={(e) => updatePromo(p.id, { subtitle: e.target.value })}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="card-body">
                              {/* Platos en promo */}
                              <div className="mb-3">
                                <label className="form-label">{tt('admin.home.promos.dishes', 'Dishes in promotion')}</label>
                                <select
                                  multiple
                                  className="form-select"
                                  value={p.menuItemIds || []}
                                  onChange={(e) => {
                                    const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                                    updatePromo(p.id, { menuItemIds: values });
                                  }}
                                  style={{ minHeight: 120 }}
                                >
                                  {menuItems.map((mi) => (
                                    <option key={mi.id} value={mi.id}>{mi.name}</option>
                                  ))}
                                </select>
                                <div className="form-text">{tt('admin.home.promos.selectDishes', 'Select one or more dishes.')}</div>
                              </div>

                              {/* Cover desde plato */}
                              {dishes.length > 0 && (
                                <div className="mb-3">
                                  <label className="form-label">{tt('admin.home.promos.cover', 'Cover image (from selected dishes)')}</label>
                                  <select
                                    className="form-select"
                                    value={selectedCoverId}
                                    onChange={(e) => {
                                      const chosen = dishes.find((d) => d.id === e.target.value);
                                      updatePromo(p.id, { imageUrl: chosen?.imageUrl || undefined });
                                    }}
                                  >
                                    <option value="">{tt('admin.home.promos.cover.choose', '— Select a dish image —')}</option>
                                    {dishes.map((d) => (
                                      <option key={d.id} value={d.id}>{d.name}</option>
                                    ))}
                                  </select>
                                  <div className="form-text">
                                    {tt('admin.home.promos.cover.help', 'This image will be shown in the public promotions list.')}
                                  </div>

                                  {p.imageUrl && (
                                    <div className="mt-2">
                                      <img
                                        src={p.imageUrl}
                                        alt="Promo cover"
                                        style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 8 }}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Preview platos */}
                              {dishes.length > 0 && (
                                <div className="mb-3">
                                  <div className="d-flex gap-2 flex-wrap">
                                    {dishes.map((d) => (
                                      <div key={d.id} className="d-flex align-items-center border rounded p-2" style={{ minWidth: 220 }}>
                                        <img
                                          src={d.imageUrl || '/placeholder.png'}
                                          alt={d.name}
                                          width={64}
                                          height={64}
                                          style={{ objectFit: 'cover', borderRadius: 8 }}
                                        />
                                        <div className="ms-2">
                                          <div className="fw-semibold">{d.name}</div>
                                          {typeof d.price === 'number' && <div className="text-muted small">Q {d.price.toFixed(2)}</div>}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Cupones */}
                              <div className="mb-2">
                                <label className="form-label">{tt('admin.home.promos.coupons', 'Coupons to attach')}</label>
                                <select
                                  multiple
                                  className="form-select"
                                  value={p.couponIds || []}
                                  onChange={(e) => {
                                    const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                                    updatePromo(p.id, { couponIds: values });
                                  }}
                                  style={{ minHeight: 120 }}
                                >
                                  {coupons.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {(c.label || tt('admin.home.promos.untitled', 'Untitled'))} — {c.code}
                                      {typeof c.discountPct === 'number' ? ` (${c.discountPct}%)` : ''}
                                    </option>
                                  ))}
                                </select>
                                <div className="form-text">
                                  {tt('admin.home.promos.coupons.help', 'Attach existing coupons to this promotion.')}
                                </div>
                              </div>

                              <div className="d-flex justify-content-end">
                                <button className="btn btn-outline-danger btn-sm" onClick={() => removePromo(p.id)}>
                                  {tt('admin.home.promos.remove', 'Remove promotion')}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* === FEATURED MENU === */}
            {tab === 'featured' && (
              <div className="card shadow-sm">
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">{tt('common.title', 'Title')}</label>
                      <input
                        className="form-control"
                        value={cfg.featuredMenu.title || ''}
                        onChange={(e) =>
                          setCfg((prev) => ({ ...prev, featuredMenu: { ...prev.featuredMenu, title: e.target.value } }))
                        }
                      />
                    </div>

                    {/* Categorías */}
                    <div className="col-12">
                      <label className="form-label">{tt('admin.home.featured.categories', 'Categories')}</label>
                      <div className="d-flex flex-wrap gap-2">
                        {categories.map((c) => {
                          const active = cfg.featuredMenu.categoryIds?.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              className={`btn btn-sm ${active ? 'btn-primary' : 'btn-outline-primary'}`}
                              onClick={() => toggleCategory(c.id)}
                            >
                              {active ? '✓ ' : ''}{c.name}
                            </button>
                          );
                        })}
                      </div>
                      <div className="form-text">{tt('admin.home.featured.categories.help', 'Select one or more categories.')}</div>
                    </div>

                    {/* Subcategorías */}
                    <div className="col-12">
                      <label className="form-label">{tt('admin.home.featured.subcategories', 'Subcategories')}</label>
                      <div className="d-flex flex-wrap gap-2">
                        {subcategories.map((s) => {
                          const active = cfg.featuredMenu.subcategoryIds?.includes(s.id);
                          if (cfg.featuredMenu.categoryIds?.length) {
                            if (s.categoryId && !cfg.featuredMenu.categoryIds.includes(s.categoryId)) return null;
                          }
                          return (
                            <button
                              key={s.id}
                              type="button"
                              className={`btn btn-sm ${active ? 'btn-success' : 'btn-outline-success'}`}
                              onClick={() => toggleSubcategory(s.id)}
                            >
                              {active ? '✓ ' : ''}{s.name}
                            </button>
                          );
                        })}
                      </div>
                      <div className="form-text">{tt('admin.home.featured.subcategories.help', 'Refine by subcategories (optional).')}</div>
                    </div>

                    {/* Items específicos */}
                    <div className="col-12">
                      <label className="form-label">{tt('admin.home.featured.items', 'Specific items (optional)')}</label>
                      <select
                        multiple
                        className="form-select"
                        value={cfg.featuredMenu.itemIds || []}
                        onChange={(e) => {
                          const values = Array.from(e.target.selectedOptions).map((o) => o.value);
                          setCfg((prev) => ({ ...prev, featuredMenu: { ...prev.featuredMenu, itemIds: values } }));
                        }}
                        style={{ minHeight: 180 }}
                      >
                        {menuItems
                          .filter((mi) => {
                            if (cfg.featuredMenu.categoryIds?.length && mi.categoryId) {
                              if (!cfg.featuredMenu.categoryIds.includes(mi.categoryId)) return false;
                            }
                            if (cfg.featuredMenu.subcategoryIds?.length && mi.subcategoryId) {
                              if (!cfg.featuredMenu.subcategoryIds.includes(mi.subcategoryId)) return false;
                            }
                            return true;
                          })
                          .map((mi) => (
                            <option key={mi.id} value={mi.id}>{mi.name}</option>
                          ))}
                      </select>
                      <div className="form-text">
                        {tt('admin.home.featured.items.help', 'If you do not select items, the frontend may use top items from the selected categories.')}
                      </div>
                    </div>

                    {/* Preview items elegidos */}
                    {cfg.featuredMenu.itemIds && cfg.featuredMenu.itemIds.length > 0 && (
                      <div className="col-12">
                        <div className="d-flex flex-wrap gap-2">
                          {cfg.featuredMenu.itemIds.map((id) => {
                            const it = menuItems.find((m) => m.id === id);
                            if (!it) return null;
                            return (
                              <div key={id} className="border rounded p-2 d-flex align-items-center" style={{ minWidth: 220 }}>
                                <img
                                  src={it.imageUrl || '/placeholder.png'}
                                  alt={it.name}
                                  width={64}
                                  height={64}
                                  style={{ objectFit: 'cover', borderRadius: 8 }}
                                />
                                <div className="ms-2">
                                  <div className="fw-semibold">{it.name}</div>
                                  {typeof it.price === 'number' && <div className="text-muted small">Q {it.price.toFixed(2)}</div>}
                                </div>
                                <button
                                  className="btn sm btn-outline-danger ms-auto"
                                  onClick={() => toggleItem(id)}
                                  title={tt('common.remove', 'Remove')}
                                >
                                  ×
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="col-12">
                      <div className="alert alert-secondary mb-0">
                        {tt('admin.home.featured.tip', 'Tip: you can combine categories/subcategories and optionally pin exact items.')}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* === GALLERY (Carrusel automático en admin) === */}
            {tab === 'gallery' && (
              <div className="card shadow-sm">
                <div className="card-body">
                  <div className="d-flex align-items-center gap-2 mb-3">
                    <input ref={galleryInputRef} type="file" accept="image/*" className="form-control" />
                    <button className="btn btn-outline-primary" onClick={handleAddGalleryImage}>
                      {tt('admin.home.gallery.add', 'Add image (auto-compress)')}
                    </button>
                  </div>

                  {(cfg.gallery.images || []).length === 0 && (
                    <div className="text-muted">{tt('admin.home.gallery.empty', 'No images yet.')}</div>
                  )}

                  {(cfg.gallery.images || []).length > 0 && (
                    <div className="position-relative">
                      <div className="ratio ratio-21x9 bg-light rounded overflow-hidden">
                        <img
                          src={cfg.gallery.images[galleryIdx]?.url}
                          alt={cfg.gallery.images[galleryIdx]?.alt || 'Gallery'}
                          style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                        />
                      </div>

                      <div className="d-flex justify-content-center mt-2">
                        {(cfg.gallery.images || []).map((_, i) => (
                          <button
                            key={i}
                            className={`btn btn-sm mx-1 ${i === galleryIdx ? 'btn-primary' : 'btn-outline-primary'}`}
                            style={{ width: 10, height: 10, borderRadius: '50%', padding: 0 }}
                            onClick={() => setGalleryIdx(i)}
                            aria-label={tt('admin.home.gallery.goto', 'Go to slide {n}', { n: String(i + 1) })}
                          />
                        ))}
                      </div>

                      <div className="row g-3 mt-3">
                        {(cfg.gallery.images || []).map((g, idx) => (
                          <div className="col-12 col-md-6" key={idx}>
                            <div className="card h-100">
                              <div className="row g-0">
                                <div className="col-4">
                                  <img
                                    src={g.url}
                                    className="img-fluid rounded-start"
                                    alt={g.alt || 'Gallery'}
                                    style={{ objectFit: 'cover', height: '100%' }}
                                  />
                                </div>
                                <div className="col-8">
                                  <div className="card-body">
                                    <label className="form-label">{tt('admin.home.gallery.alt', 'Alt text')}</label>
                                    <input
                                      className="form-control"
                                      placeholder={tt('admin.home.gallery.altPh', 'Alt text')}
                                      value={g.alt || ''}
                                      onChange={(e) => {
                                        setCfg((prev) => {
                                          const images = [...prev.gallery.images];
                                          images[idx] = { ...images[idx], alt: e.target.value };
                                          return { ...prev, gallery: { images } };
                                        });
                                      }}
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* === ABOUT US === */}
            {tab === 'about' && (
              <div className="card shadow-sm">
                <div className="card-body">
                  <div className="row g-4">
                    <div className="col-md-6">
                      <label className="form-label">{tt('common.title', 'Title')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.about.titlePh', 'About us')}
                        value={cfg.aboutUs?.title || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, aboutUs: { ...(prev.aboutUs || {}), title: e.target.value } }))}
                      />
                    </div>

                    <div className="col-12">
                      <label className="form-label">{tt('common.text', 'Text')}</label>
                      <textarea
                        className="form-control"
                        rows={6}
                        placeholder={tt('admin.home.about.textPh', 'Tell your story, mission, values…')}
                        value={cfg.aboutUs?.text || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, aboutUs: { ...(prev.aboutUs || {}), text: e.target.value } }))}
                      />
                    </div>

                    <div className="col-md-6">
                      <label className="form-label">{tt('admin.home.about.image', 'Image')}</label>
                      <div className="d-flex gap-2">
                        <input ref={aboutImageInputRef} type="file" accept="image/*" className="form-control" />
                        <button className="btn btn-outline-primary" onClick={handleUploadAboutImage}>
                          {tt('common.upload', 'Upload')}
                        </button>
                        {cfg.aboutUs?.imageUrl && (
                          <button
                            className="btn btn-outline-danger"
                            onClick={() => setCfg((prev) => ({ ...prev, aboutUs: { ...(prev.aboutUs || {}), imageUrl: '' } }))}
                          >
                            {tt('common.remove', 'Remove')}
                          </button>
                        )}
                      </div>
                      <div className="form-text">
                        {tt('admin.home.about.tip', 'Recommended ~1600×1200 (auto-compressed).')}
                      </div>
                    </div>

                    {cfg.aboutUs?.imageUrl && (
                      <div className="col-md-6">
                        <div className="ratio ratio-16x9 rounded overflow-hidden border">
                          <img src={cfg.aboutUs.imageUrl} alt="About cover" style={{ objectFit: 'cover', width: '100%', height: '100%' }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* === NEWSLETTER === */}
            {tab === 'newsletter' && (
              <div className="card shadow-sm border-0">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h2 className="h5 m-0">{tt('admin.home.newsletter.title', 'Newsletter')}</h2>
                      <small className="text-muted">
                        {tt('admin.home.newsletter.subtitle', 'Configure UI copy and form status messages.')}
                      </small>
                    </div>
                  </div>

                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">{tt('common.title', 'Title')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.newsletter.titlePh', 'Join our newsletter')}
                        value={cfg?.newsletter?.title || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, newsletter: { ...(prev as any).newsletter, title: e.target.value } as any }))}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{tt('admin.home.newsletter.subtext', 'Subtext')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.newsletter.textDefault', 'News, promos & seasonal dishes — no spam.')}
                        value={cfg?.newsletter?.text || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, newsletter: { ...(prev as any).newsletter, text: e.target.value } as any }))}
                      />
                    </div>

                    <div className="col-md-4">
                      <label className="form-label">{tt('admin.home.newsletter.emailPhLabel', 'Email placeholder')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.newsletter.emailPh', 'Your email')}
                        value={cfg?.newsletter?.placeholderEmail || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, newsletter: { ...(prev as any).newsletter, placeholderEmail: e.target.value } as any }))}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">{tt('admin.home.newsletter.buttonLabel', 'Button label')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.newsletter.btn', 'Subscribe')}
                        value={cfg?.newsletter?.buttonLabel || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, newsletter: { ...(prev as any).newsletter, buttonLabel: e.target.value } as any }))}
                      />
                    </div>

                    <div className="col-md-4">
                      <div className="alert alert-info mb-0">
                        {tt('admin.home.newsletter.postInfo', 'The form posts to ')}
                        <code>/api/newsletter/subscribe</code>{' '}
                        {tt('admin.home.newsletter.postInfo2', 'with email validation and honeypot.')}
                      </div>
                    </div>

                    <div className="col-md-6">
                      <label className="form-label">{tt('admin.home.newsletter.success', 'Success message')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.newsletter.ok', 'Thanks! Check your inbox.')}
                        value={cfg?.newsletter?.successMsg || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, newsletter: { ...(prev as any).newsletter, successMsg: e.target.value } as any }))}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{tt('admin.home.newsletter.error', 'Error message')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.newsletter.err', 'Sorry, something went wrong. Try again.')}
                        value={cfg?.newsletter?.errorMsg || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, newsletter: { ...(prev as any).newsletter, errorMsg: e.target.value } as any }))}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* === CONTACT === */}
            {tab === 'contact' && (
              <div className="card shadow-sm border-0">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <div>
                      <h2 className="h5 m-0">{tt('admin.home.contact.title', 'Contact')}</h2>
                      <small className="text-muted">
                        {tt('admin.home.contact.subtitle', 'Renders branch cards (no form). Phone/Email/Web as clickable links.')}
                      </small>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={() => {
                        const newBranch: ContactBranch = {
                          branchId: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
                          branchName: tt('admin.home.contact.newBranch', 'New branch'),
                          address: '',
                          phone: '',
                          email: '',
                          webpage: '',
                        };
                        setCfg((prev) => {
                          const prevList = (prev as any)?.contact?.branches || [];
                          return {
                            ...prev,
                            contact: {
                              title: (prev as any)?.contact?.title || tt('admin.home.contact.titleDefault', 'Contact us'),
                              text: (prev as any)?.contact?.text || tt('admin.home.contact.textDefault', 'Find us or reach out by phone/email.'),
                              branches: [...prevList, newBranch],
                            } as any,
                          };
                        });
                      }}
                    >
                      {tt('admin.home.contact.addBranch', '+ Add branch')}
                    </button>
                  </div>

                  <div className="row g-3 mb-3">
                    <div className="col-md-6">
                      <label className="form-label">{tt('admin.home.contact.sectionTitle', 'Section title')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.contact.titleDefault', 'Contact us')}
                        value={(cfg as any)?.contact?.title || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, contact: { ...(prev as any).contact, title: e.target.value } as any }))}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{tt('admin.home.contact.intro', 'Intro text')}</label>
                      <input
                        className="form-control"
                        placeholder={tt('admin.home.contact.introPh', 'We’d love to hear from you.')}
                        value={(cfg as any)?.contact?.text || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, contact: { ...(prev as any).contact, text: e.target.value } as any }))}
                      />
                    </div>
                  </div>

                  {(((cfg as any)?.contact?.branches || []) as Array<ContactBranch>).length === 0 && (
                    <div className="text-muted">{tt('admin.home.contact.noBranches', 'No branches yet. Use “Add branch”.')}</div>
                  )}

                  <div className="row g-3">
                    {(((cfg as any)?.contact?.branches || []) as Array<ContactBranch>).map((b, idx) => (
                      <div className="col-12" key={b.branchId || idx}>
                        <div className="card shadow-sm">
                          <div className="card-body">
                            <div className="d-flex justify-content-between align-items-start mb-2">
                              <span className="badge bg-secondary">{tt('admin.home.contact.branch', 'Branch')}</span>
                              <button
                                className="btn btn-outline-danger btn-sm"
                                onClick={() =>
                                  setCfg((prev) => {
                                    const list = [ ...(((prev as any)?.contact?.branches || []) as Array<ContactBranch>) ];
                                    list.splice(idx, 1);
                                    return { ...prev, contact: { ...(prev as any).contact, branches: list } as any };
                                  })
                                }
                              >
                                {tt('common.remove', 'Remove')}
                              </button>
                            </div>

                            <div className="row g-3">
                              <div className="col-md-4">
                                <label className="form-label">{tt('admin.home.contact.branchName', 'Branch name')}</label>
                                <input
                                  className="form-control"
                                  value={b.branchName || ''}
                                  onChange={(e) =>
                                    setCfg((prev) => {
                                      const list = [ ...(((prev as any)?.contact?.branches || []) as Array<ContactBranch>) ];
                                      list[idx] = { ...list[idx], branchName: e.target.value };
                                      return { ...prev, contact: { ...(prev as any).contact, branches: list } as any };
                                    })
                                  }
                                />
                              </div>
                              <div className="col-md-8">
                                <label className="form-label">{tt('common.address', 'Address')}</label>
                                <input
                                  className="form-control"
                                  value={b.address || ''}
                                  onChange={(e) =>
                                    setCfg((prev) => {
                                      const list = [ ...(((prev as any)?.contact?.branches || []) as Array<ContactBranch>) ];
                                      list[idx] = { ...list[idx], address: e.target.value };
                                      return { ...prev, contact: { ...(prev as any).contact, branches: list } as any };
                                    })
                                  }
                                />
                              </div>

                              <div className="col-md-4">
                                <label className="form-label">{tt('common.phone', 'Phone')}</label>
                                <input
                                  className="form-control"
                                  placeholder="+502 1234 5678"
                                  value={b.phone || ''}
                                  onChange={(e) =>
                                    setCfg((prev) => {
                                      const list = [ ...(((prev as any)?.contact?.branches || []) as Array<ContactBranch>) ];
                                      list[idx] = { ...list[idx], phone: e.target.value };
                                      return { ...prev, contact: { ...(prev as any).contact, branches: list } as any };
                                    })
                                  }
                                />
                              </div>
                              <div className="col-md-4">
                                <label className="form-label">Email</label>
                                <input
                                  type="email"
                                  className="form-control"
                                  placeholder="info@example.com"
                                  value={b.email || ''}
                                  onChange={(e) =>
                                    setCfg((prev) => {
                                      const list = [ ...(((prev as any)?.contact?.branches || []) as Array<ContactBranch>) ];
                                      list[idx] = { ...list[idx], email: e.target.value };
                                      return { ...prev, contact: { ...(prev as any).contact, branches: list } as any };
                                    })
                                  }
                                />
                              </div>
                              <div className="col-md-4">
                                <label className="form-label">{tt('admin.home.contact.web', 'Webpage')}</label>
                                <input
                                  type="url"
                                  className="form-control"
                                  placeholder="https://example.com"
                                  value={b.webpage || ''}
                                  onChange={(e) =>
                                    setCfg((prev) => {
                                      const list = [ ...(((prev as any)?.contact?.branches || []) as Array<ContactBranch>) ];
                                      list[idx] = { ...list[idx], webpage: e.target.value };
                                      return { ...prev, contact: { ...(prev as any).contact, branches: list } as any };
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* === SEO === */}
            {tab === 'seo' && (
              <div className="card shadow-sm">
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">{tt('admin.home.seo.title', 'SEO Title')}</label>
                      <input
                        className="form-control"
                        value={cfg.seo?.title || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, seo: { ...(prev.seo || {}), title: e.target.value } }))}
                      />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">{tt('admin.home.seo.og', 'OG Image URL')}</label>
                      <input
                        className="form-control"
                        value={cfg.seo?.ogImage || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, seo: { ...(prev.seo || {}), ogImage: e.target.value } }))}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">{tt('admin.home.seo.desc', 'Description')}</label>
                      <textarea
                        className="form-control"
                        rows={3}
                        value={cfg.seo?.description || ''}
                        onChange={(e) => setCfg((prev) => ({ ...prev, seo: { ...(prev.seo || {}), description: e.target.value } }))}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">{tt('admin.home.seo.keywords', 'Keywords (comma separated)')}</label>
                      <input
                        className="form-control"
                        value={(cfg.seo?.keywords || []).join(', ')}
                        onChange={(e) =>
                          setCfg((prev) => ({
                            ...prev,
                            seo: {
                              ...(prev.seo || {}),
                              keywords: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* === PUBLISH === */}
            {tab === 'publish' && (
              <div className="card shadow-sm">
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div className="fw-semibold">
                        {tt('admin.home.publish.current', 'Current status:')} {cfg.publish?.status || 'draft'}
                      </div>
                      <div className="text-muted">
                        {tt('admin.home.publish.version', 'Version:')} {cfg.publish?.version ?? 0}
                      </div>
                      <div className="small text-muted mt-2">
                        <strong>{tt('admin.home.publish.what', 'What does Publish do?')}</strong> <br />
                        <span>
                          <em>{tt('admin.home.btn.saveDraft', 'Save draft')}</em>{' '}
                          {tt('admin.home.publish.draftInfo', 'saves the configuration as draft (does not affect the public page).')}
                          <br />
                          <em>{tt('admin.home.btn.publish', 'Publish')}</em>{' '}
                          {tt('admin.home.publish.publishInfo', 'increments the version and marks it as published. The public home (/) should read the published version.')}
                        </span>
                      </div>
                    </div>
                    <div className="d-flex gap-2">
                      <button className="btn btn-outline-secondary" disabled={saving} onClick={saveDraft}>
                        {tt('admin.home.btn.saveDraft', 'Save draft')}
                      </button>
                      <button className="btn btn-primary" disabled={saving} onClick={publishNow}>
                        {tt('admin.home.btn.publish', 'Publish')}
                      </button>
                    </div>
                  </div>
                  <hr />
                  <div className="small text-muted">
                    {tt('admin.home.publish.footer', 'When published, the public home will use this configuration marked as published.')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </ToolGate>
      </OnlyAdmin>
    </Protected>
    
  );
}
