"use client";

import { useEffect, useState, useMemo } from "react";
import { t } from "@/lib/i18n/t";
import Hero from "@/app/(tenant)/[tenantId]/components/home/Hero";
import PromoStrip from "@/app/(tenant)/[tenantId]/components/home/PromoStrip";
import FeaturedMenu from "@/app/(tenant)/[tenantId]/components/home/FeaturedMenu";
import Gallery from "@/app/(tenant)/[tenantId]/components/home/Gallery";
import { useTenantId } from "@/lib/tenant/context";
import { tenantPath } from "@/lib/tenant/paths";

/* 🔹 Firebase client (init) + Firestore */
import "@/lib/firebase/client";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";

type HeroSlide = {
  imageUrl: string;
  imageAlt?: string;
  headline: string;
  sub?: string;
  cta?: { label: string; href: string };
  overlay?: "dark" | "light" | "none";
};
type HeroVideo = {
  url: string;
  posterUrl?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  blurPx?: number;
};
type HeroData = {
  variant: "image" | "carousel" | "video";
  slides?: HeroSlide[];
  video?: HeroVideo;
};
type Promo = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: "primary" | "success" | "warning" | "danger" | "info";
  imageUrl?: string;
  discountPct?: number;
  href?: string;
  menuItemIds?: string[];
  couponIds?: string[];
  dishes?: Array<{ id: string; name: string; imageUrl?: string; price?: number }>;
};
type Item = { id: string; name: string; price?: number; imageUrl?: string };
type CategoryChip = { id: string; name: string };

export default function HomeClient({
  serverLang,
  heroData,
  promos,
  featuredTitle,
  featuredItems,
  featuredCategories,
  galleryImages,
}: {
  serverLang: string;
  heroData: HeroData;
  promos: Promo[];
  featuredTitle?: string;
  featuredItems: Item[];
  featuredCategories: CategoryChip[];
  galleryImages: Array<{ url: string; alt?: string }>;
}) {
  const [clientLang, setClientLang] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tenant.language");
      if (raw) setClientLang(raw);
    } catch {}
  }, []);
  const lang = clientLang || serverLang;

  // ✅ tenant
  const tenantId = useTenantId();
  const withTenant = useMemo(() => {
    return (p: string) => {
      const norm = p.startsWith("/") ? p : `/${p}`;
      if (!tenantId) return norm;

      if (norm === `/${tenantId}` || norm.startsWith(`/${tenantId}/`)) return norm;
      return tenantPath(tenantId, norm);
    };
  }, [tenantId]);

  /* 🔹 Nombre de marca */
  const [brandName, setBrandName] = useState<string>("OrderCraft");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!tenantId) return;
        const db = getFirestore();

        // 1️⃣ Preferir tenants/{tenantId}.company.name
        const rootRef = doc(db, "tenants", tenantId);
        const rootSnap = await getDoc(rootRef);
        const companyName = rootSnap.exists()
          ? rootSnap.data()?.company?.name?.toString()?.trim()
          : "";

        if (!cancelled && companyName) {
          setBrandName(companyName);
          return;
        }

        // 2️⃣ Fallback: tenantOrders
        const colRef = collection(db, "tenants", tenantId, "tenantOrders");
        const q = query(colRef, orderBy("createdAt", "desc"), limit(1));
        const snap = await getDocs(q);
        const data = snap.docs[0]?.data() as any | undefined;
        const name = data?.customer?.name?.toString()?.trim();
        if (!cancelled && name) setBrandName(name);
      } catch {
        // silencioso
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  // Estado visual del navbar (claro/oscuro) al hacer scroll
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((v) => !v);
  const close = () => setOpen(false);

  useEffect(() => {
    const onHash = () => close();
    const onResize = () => {
      if (window.innerWidth >= 992) close();
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  /** Navbar */
  const Navbar = () => (
    <nav
      className={`navbar navbar-expand-lg fixed-top border-0 ${
        scrolled ? "nav--dark navbar-light" : "nav--light navbar-dark"
      }`}
    >
      <div className="container">
        <a
          className="navbar-brand fw-semibold"
          href={withTenant("/")}
          onClick={close}
        >
          {brandName}
        </a>

        <button
          className="navbar-toggler"
          type="button"
          aria-label={t(lang, "nav.toggle")}
          aria-expanded={open ? "true" : "false"}
          onClick={toggle}
        >
          <span className="navbar-toggler-icon" />
        </button>

        <div
          className={`navbar-collapse ${
            open ? "d-block" : "d-none"
          } d-lg-flex align-items-lg-center`}
        >
          <ul
            className="navbar-nav me-auto mb-2 mb-lg-0"
            onClick={close}
          >
            <li className="nav-item">
              <a className="nav-link" href="#promos">
                {t(lang, "nav.promotions")}
              </a>
            </li>
            <li className="nav-item">
              <a className="nav-link" href="#featured">
                {t(lang, "nav.featured")}
              </a>
            </li>
            <li className="nav-item">
              <a className="nav-link" href="#gallery">
                {t(lang, "nav.gallery")}
              </a>
            </li>
            <li className="nav-item">
              <a className="nav-link" href="#aboutus">
                {t(lang, "nav.aboutus")}
              </a>
            </li>
            <li className="nav-item">
              <a className="nav-link" href="#newsletter">
                Newsletter
              </a>
            </li>
            <li className="nav-item">
              <a className="nav-link" href="#contact">
                Contact
              </a>
            </li>
            <li className="nav-item">
              <a className="nav-link" href={withTenant("/menu")}>
                {t(lang, "nav.menu")}
              </a>
            </li>
          </ul>

          <div className="d-flex gap-2 pb-3 pb-lg-0">
            <a
              className="btn btn-outline-light swap-outline"
              href={withTenant("/login")}
              onClick={close}
            >
              {t(lang, "nav.login")}
            </a>
            <a
              className="btn btn-primary btn-cta"
              href={withTenant("/account")}
              onClick={close}
            >
              {t(lang, "nav.signup")}
            </a>
          </div>
        </div>
      </div>

      <style jsx>{`
        :global(html) {
          scroll-padding-top: 72px;
        }
        .navbar {
          z-index: 1040;
          transition: color 0.2s ease, background-color 0.2s ease;
        }
        .nav--light {
          background: rgba(0, 0, 0, 0.24);
          -webkit-backdrop-filter: saturate(140%) blur(10px);
          backdrop-filter: saturate(140%) blur(10px);
        }
        .nav--dark {
          background: rgba(255, 255, 255, 0.75);
          -webkit-backdrop-filter: saturate(140%) blur(10px);
          backdrop-filter: saturate(140%) blur(10px);
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
        }
        .nav--light :global(.navbar-brand),
        .nav--light :global(.nav-link) {
          color: #fff !important;
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
        }
        .nav--dark :global(.navbar-brand),
        .nav--dark :global(.nav-link) {
          color: #212529 !important;
        }
      `}</style>
    </nav>
  );

  return (
    <>
      <Navbar />
      <main>
        <Hero data={heroData} lang={lang} />
        {promos?.length > 0 && (
          <section id="promos" className="py-5 border-top">
            <div className="container">
              <h2 className="h4 mb-3">{t(lang, "home.promos.title")}</h2>
              <PromoStrip promos={promos} lang={lang} />
            </div>
          </section>
        )}
        <section id="featured" className="py-5 border-top">
          <div className="container">
            <h2 className="h4 mb-3">
              {featuredTitle || t(lang, "home.featured.title")}
            </h2>
            <FeaturedMenu items={featuredItems} lang={lang} />
          </div>
        </section>
        {galleryImages?.length > 0 && (
          <section id="gallery" className="py-5 border-top">
            <div className="container">
              <h2 className="h4 mb-3">{t(lang, "home.gallery.title")}</h2>
              <Gallery images={galleryImages} />
            </div>
          </section>
        )}
      </main>
    </>
  );
}
