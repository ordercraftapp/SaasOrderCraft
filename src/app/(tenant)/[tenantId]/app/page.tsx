// src/app/(tenant)/[tenantId]/app/page.tsx
export const runtime = 'nodejs';        // ✅ necesario para usar Firebase Admin en Vercel
export const revalidate = 300;          // ✅ mantienes ISR como ya lo tenías
export const dynamic = 'force-dynamic'; // ⬅️ opcional mientras pruebas (desactiva caché)

import type { Metadata } from 'next';
import HomeClient from '@/app/(tenant)/[tenantId]/components/home/HomeClient';

// 👇 NUEVO: secciones separadas para controlar el orden
import AboutUs from '@/app/(tenant)/[tenantId]/components/home/AboutUs';
import Newsletter from '@/app/(tenant)/[tenantId]/components/home/Newsletter';
import ContactList from '@/app/(tenant)/[tenantId]/components/home/ContactList';

// 🔐 Firestore Admin
import { db } from '@/lib/firebase/admin';

type TimestampLike = { toDate?: () => Date } | number | Date | null | undefined;

type HeroSlide = {
  imageUrl: string;
  imageAlt?: string;
  headline: string;
  sub?: string;
  cta?: { label: string; href: string };
  overlay?: 'dark' | 'light' | 'none';
};
type HeroVideo = {
  url: string;
  posterUrl?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  blurPx?: number;
};
type PromoEntry = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  imageUrl?: string;
  discountPct?: number;
  href?: string;
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

/* 👇 NEW: tipos de Newsletter y Contact */
type NewsletterCfg = {
  title?: string;
  text?: string;
  placeholderEmail?: string;
  buttonLabel?: string;
  successMsg?: string;
  errorMsg?: string;
  // imageUrl?: string; // opcional futuro
};

/** Contacto ACTUALIZADO para soportar nuevo esquema y legacy */
type ContactBranch = {
  branchId: string;
  branchName?: string;
  address?: string;

  // nuevo esquema
  phone?: string;
  email?: string;
  webpage?: string;

  // legacy (tolerado)
  phones?: string[];
  emails?: string[];
  // schedule?: string; // opcional futuro
};
type ContactCfg = {
  title?: string;
  text?: string;
  branches?: ContactBranch[];
};

type HomeConfig = {
  hero: { variant: 'image' | 'carousel' | 'video'; slides?: HeroSlide[]; video?: HeroVideo };
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

  // 👇 NUEVO: About Us opcional en la config
  aboutUs?: {
    title?: string;
    text?: string;
    imageUrl?: string;
  };

  /* 👇 NUEVO: Newsletter + Contact opcionales */
  newsletter?: NewsletterCfg;
  contact?: ContactCfg;

  publish: { status: 'draft' | 'published'; version: number };
};

function tsToDate(x: TimestampLike): Date | null {
  if (!x) return null;
  if (typeof x === 'number') return new Date(x);
  if (x instanceof Date) return x;
  if (typeof x === 'object' && 'toDate' in x && typeof (x as any).toDate === 'function') {
    return (x as any).toDate() as Date;
  }
  return null;
}

async function getHomeConfig(tenantId: string): Promise<HomeConfig | null> {
  const snap = await db
    .collection('tenants').doc(tenantId)
    .collection('settings').doc('homeConfig')
    .get();
  return snap.exists ? (snap.data() as HomeConfig) : null;
}

async function getUiLanguage(tenantId: string): Promise<string> {
  try {
    const s = await db
      .collection('tenants').doc(tenantId)
      .collection('settings').doc('general')
      .get();
    const lang = (s.exists && (s.data() as any)?.language) || 'es';
    return typeof lang === 'string' ? lang : 'es';
  } catch {
    return 'es';
  }
}

/** ✅ NUEVO: leer el nombre de marca 100% en servidor */
async function getTenantBrandName(tenantId: string): Promise<string> {
  // 1) Preferimos tenants/{tenantId}.company.name
  const rootRef = db.collection('tenants').doc(tenantId);
  const rootSnap = await rootRef.get();
  const companyName = rootSnap.exists ? (rootSnap.get('company.name') as string | undefined) : undefined;
  if (companyName && companyName.toString().trim()) return companyName.toString().trim();

  // 2) Fallback: último tenantOrder por createdAt desc → customer.name
  const ordersSnap = await rootRef
    .collection('tenantOrders')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  const orderData = ordersSnap.docs[0]?.data() as any | undefined;
  const customerName = orderData?.customer?.name?.toString()?.trim();
  return customerName || '';
}

// ===== Catálogo =====
type Category = { id: string; name: string };
type Subcategory = { id: string; name: string; categoryId?: string };
type MenuItem = {
  id: string;
  name: string;
  price?: number;
  imageUrl?: string;
  categoryId?: string;
  subcategoryId?: string;
  categories?: string[];
  // ... otros campos que no enviaremos al cliente
};

// ===== Catálogo (Admin SDK: OK listar aunque las reglas del cliente bloqueen list)
async function fetchCategories(tenantId: string, ids?: string[]): Promise<Category[]> {
  const s = await db.collection('tenants').doc(tenantId).collection('categories').get();
  const all = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Category[];
  return ids?.length ? all.filter((c) => ids.includes(c.id)) : all;
}
async function fetchSubcategories(tenantId: string, ids?: string[]): Promise<Subcategory[]> {
  const s = await db.collection('tenants').doc(tenantId).collection('subcategories').get();
  const all = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Subcategory[];
  return ids?.length ? all.filter((sc) => ids.includes(sc.id)) : all;
}
async function fetchAllMenuItems(tenantId: string): Promise<MenuItem[]> {
  const s = await db.collection('tenants').doc(tenantId).collection('menuItems').get();
  return s.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as MenuItem[];
}
/** 🔎 Cupones desde `tenants/{tenantId}/promotions` */
async function fetchCouponsMap(tenantId: string): Promise<Map<string, string>> {
  const snap = await db.collection('tenants').doc(tenantId).collection('promotions').get();
  const map = new Map<string, string>();
  snap.docs.forEach((d) => {
    const data = d.data() as any;
    const code = typeof data?.code === 'string' ? data.code : '';
    if (code) map.set(d.id, code);
  });
  return map;
}

function filterMenuItems(
  all: MenuItem[],
  opts: { catIds?: string[]; subIds?: string[]; itemIds?: string[] }
): MenuItem[] {
  const { catIds = [], subIds = [], itemIds = [] } = opts;
  if (itemIds.length) return all.filter((m) => itemIds.includes(m.id));

  let result = all;
  if (catIds.length) {
    result = result.filter((mi) => {
      if (mi.categoryId && catIds.includes(mi.categoryId)) return true;
      if (Array.isArray(mi.categories) && mi.categories.some((c) => catIds.includes(c))) return true;
      return false;
    });
  }
  if (subIds.length) {
    result = result.filter((mi) => mi.subcategoryId && subIds.includes(mi.subcategoryId));
  }
  return result;
}

// ====== SEO
export async function generateMetadata({ params }: { params: { tenantId: string } }): Promise<Metadata> {
  const tenantId = params.tenantId;
  const cfg = await getHomeConfig(tenantId);
  const title = cfg?.seo?.title || 'OrderCraft — Fresh & Fast';
  const description = cfg?.seo?.description || 'Order your favorite dishes online. Fast delivery, fresh taste.';
  const ogImage = cfg?.seo?.ogImage || '/og-default.png';
  const keywords = (cfg?.seo?.keywords || ['restaurant', 'delivery', 'food', 'menu']).join(', ');
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://ordercraft.datacraftcoders.com'),
    title, description, keywords,
    alternates: { canonical: '/' },
    openGraph: { title, description, type: 'website', url: '/', images: [{ url: ogImage }] },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
    robots: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  };
}

/** Helpers para SANEAR (solo props planas) */
function toPlainItem(m: MenuItem): { id: string; name: string; price?: number; imageUrl?: string } {
  return {
    id: String(m.id),
    name: String(m.name),
    price: typeof m.price === 'number' ? m.price : undefined,
    imageUrl: m.imageUrl ? String(m.imageUrl) : undefined,
  };
}
function toPlainCategory(c: Category): { id: string; name: string } {
  return { id: String(c.id), name: String(c.name) };
}
function toPlainPromo(p: PromoEntry) {
  return {
    id: String(p.id),
    title: String(p.title),
    subtitle: p.subtitle ? String(p.subtitle) : undefined,
    badge: p.badge,
    imageUrl: p.imageUrl ? String(p.imageUrl) : undefined,
    discountPct: typeof p.discountPct === 'number' ? p.discountPct : undefined,
    href: p.href ? String(p.href) : undefined,
    menuItemIds: Array.isArray(p.menuItemIds) ? p.menuItemIds.map(String) : [],
    couponIds: Array.isArray(p.couponIds) ? p.couponIds.map(String) : [],
    // Omitimos startAt/endAt para evitar objetos especiales en el cliente
  };
}

/** Normalizar contact para asegurar phone/email/webpage con fallback a legacy arrays */
function normalizeContact(c?: ContactCfg): ContactCfg | undefined {
  if (!c) return c;
  const branches = (c.branches || []).map((b) => {
    const phone = (b.phone && b.phone.trim()) || (b.phones && b.phones[0]) || '';
    const email = (b.email && b.email.trim()) || (b.emails && b.emails[0]) || '';
    return {
      ...b,
      phone: phone || undefined,
      email: email || undefined,
      webpage: (b.webpage && b.webpage.trim()) || undefined,
    };
  });
  return { ...c, branches };
}

export default async function HomePage({ params }: { params: { tenantId: string } }) {
  const tenantId = params.tenantId;

  const serverLang = await getUiLanguage(tenantId);
  const cfg = (await getHomeConfig(tenantId)) || {
    hero: { variant: 'image', slides: [] },
    promos: [],
    featuredMenu: { title: 'Featured', categoryIds: [], subcategoryIds: [], itemIds: [], items: [] },
    gallery: { images: [] },

    // 👇 NUEVO: default vacío es seguro
    aboutUs: { title: '', text: '', imageUrl: '' },

    // 👇 NUEVO: defaults seguros para secciones nuevas
    newsletter: {
      title: 'Join our newsletter',
      text: 'News, promos & seasonal dishes — no spam.',
      placeholderEmail: 'Your email',
      buttonLabel: 'Subscribe',
      successMsg: 'Thanks! Check your inbox.',
      errorMsg: 'Sorry, something went wrong. Try again.',
    },
    contact: {
      title: 'Contact us',
      text: 'Find us or reach out by phone/email.',
      branches: [],
    },

    publish: { status: 'draft', version: 0 },
  } as HomeConfig;

  // ✅ NUEVO: obtener brandName en servidor
  const brandName = await getTenantBrandName(tenantId);

  // Promos activas
  const now = new Date();
  const activePromos = (cfg.promos || []).filter((p) => {
    if (!p.active) return false;
    const start = tsToDate(p.startAt);
    const end   = tsToDate(p.endAt);
    if (start && start > now) return false;
    if (end && end < now) return false;
    return true;
  });

  const [allCats, /* allSubs no usado aquí */, allItems, couponsMap] = await Promise.all([
    fetchCategories(tenantId),
    fetchSubcategories(tenantId),
    fetchAllMenuItems(tenantId),
    fetchCouponsMap(tenantId),
  ]);

  // Featured items (sanear SIEMPRE a {id,name,price,imageUrl})
  const manualItems = (cfg.featuredMenu?.itemIds?.length
    ? filterMenuItems(allItems, { itemIds: cfg.featuredMenu.itemIds })
    : []) as MenuItem[];

  const filteredItemsRaw = manualItems.length
    ? manualItems
    : filterMenuItems(allItems, {
        catIds: cfg.featuredMenu?.categoryIds,
        subIds: cfg.featuredMenu?.subcategoryIds,
      });

  const featuredItems = (cfg.featuredMenu?.items?.length
    ? cfg.featuredMenu.items.map((i) => ({
        id: String(i.menuItemId),
        name: String(i.name),
        price: Number(i.price),
        imageUrl: i.imageUrl ? String(i.imageUrl) : undefined,
      }))
    : filteredItemsRaw.map(toPlainItem)
  );

  // Categorías visibles (chips) — sanear a {id,name}
  const featuredCategories =
    cfg.featuredMenu?.categoryIds?.length
      ? allCats.filter((c) => cfg.featuredMenu!.categoryIds!.includes(c.id)).map(toPlainCategory)
      : [];

  // Enriquecer promos con platos y cupones (SANEAR)
  const itemsById = new Map(allItems.map((m) => [m.id, m]));
  const activePromosEnriched = activePromos.map((p) => {
    const base = toPlainPromo(p);
    const dishes = (p.menuItemIds || [])
      .map((id) => itemsById.get(id))
      .filter(Boolean)
      .map((m) => toPlainItem(m as MenuItem));
    const couponCodes = (p.couponIds || [])
      .map((id) => couponsMap.get(id))
      .filter(Boolean) as string[];
    return { ...base, dishes, couponCodes };
  });

  // JSON-LD (solo strings/primitivos)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: cfg?.seo?.title || 'OrderCraft',
    description: cfg?.seo?.description || 'Online restaurant ordering',
    url: process.env.NEXT_PUBLIC_SITE_URL || 'https://ordercraft.datacraftcoders.com',
    image: cfg?.seo?.ogImage || (cfg.hero?.slides?.[0]?.imageUrl ?? undefined),
    servesCuisine: ['American', 'Latin', 'Fast Food', 'Pizza', 'Burgers'],
    priceRange: '$$',
    acceptsReservations: false,
    hasMenu: `${process.env.NEXT_PUBLIC_SITE_URL || ''}/menu`,
  };

  const heroData = {
    ...cfg.hero,
    video: cfg.hero.video ? { blurPx: 3, ...cfg.hero.video } : cfg.hero.video,
  };

  // ✅ Normalizamos contact (phone/email/webpage) antes de pasar al cliente
  const contactNormalized = normalizeContact(cfg.contact);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* 1) HERO + FEATURED + PROMOTIONS (+ gallery si aplica) */}
      <HomeClient
        serverLang={serverLang}
        heroData={heroData as any}
        promos={activePromosEnriched as any}
        featuredTitle={cfg.featuredMenu?.title}
        featuredItems={featuredItems as any}
        featuredCategories={featuredCategories as any}
        galleryImages={(cfg.gallery?.images || []).map((g) => ({
          url: String(g.url),
          alt: g.alt ? String(g.alt) : undefined,
        }))}
        // ⛔️ No pasamos newsletter/contact para controlar el orden abajo
        // newsletter={cfg.newsletter}
        // contact={contactNormalized}

        // ✅ NUEVO: nombre de marca desde servidor (impide flicker)
        brandName={brandName}
      />

      {/* 4) ABOUT US */}
      <AboutUs
        title={cfg.aboutUs?.title}
        text={cfg.aboutUs?.text}
        imageUrl={cfg.aboutUs?.imageUrl}
      />

      {/* 5) NEWSLETTER */}
      <section id="newsletter" className="py-5">
        <div className="container">
          <div className="mx-auto" style={{ maxWidth: 760 }}>
            <Newsletter
              cfg={cfg.newsletter}
            />
          </div>
        </div>
      </section>

      {/* 6) CONTACT */}
      <ContactList cfg={contactNormalized} />
    </>
  );
}

