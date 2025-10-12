"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { t } from "@/lib/i18n/t";
import { useTenantId } from "@/lib/tenant/context";
import { tenantPath } from '@/lib/tenant/paths';


type Item = { id: string; name: string; price?: number; imageUrl?: string };

export default function FeaturedMenu({
  items,
  lang,
}: {
  items: Item[];
  lang?: string; // ← opcional; si no llega, resolvemos desde localStorage
}) {
  const [clientLang, setClientLang] = useState<string | null>(null);
  const tenantId = useTenantId();

  useEffect(() => {
    try {
      const raw = localStorage.getItem("tenant.language");
      if (raw) setClientLang(raw);
    } catch {}
  }, []);
  const resolvedLang = lang || clientLang || "es";

  const withTenant = (p: string) => {
  const norm = p.startsWith('/') ? p : `/${p}`;
  if (!tenantId) return norm;

  // evita doble prefijo si ya viene con '/{tenantId}/...'
  if (norm === `/${tenantId}` || norm.startsWith(`/${tenantId}/`)) return norm;

  return tenantPath(tenantId, norm);
};

  // ✅ resolver src de imagen (si es relativa → tenant-aware; si es absoluta se respeta)
  const resolveImg = (src?: string) => {
    const val = src || "/menu-fallback.jpg";
    const isAbsolute = /^(https?:)?\/\//i.test(val) || val.startsWith("data:");
    return isAbsolute ? val : withTenant(val);
  };

  if (!items?.length) {
    return <div className="text-muted">{t(resolvedLang, "home.featured.empty")}</div>;
  }

  const menuHref = useMemo(() => withTenant("/menu"), [tenantId]);

  return (
    <div className="row g-3">
      {items.map((it) => (
        <div className="col-12 col-sm-6 col-lg-4" key={it.id}>
          <article className="card h-100 shadow-sm">
            <div className="ratio ratio-4x3">
              <Image
                src={resolveImg(it.imageUrl)}
                alt={it.name}
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                loading="lazy"
                style={{ objectFit: "cover" }}
              />
            </div>
            <div className="card-body d-flex flex-column">
              <h3 className="h6">{it.name}</h3>
              <div className="mt-auto">
                <a className="btn btn-outline-secondary" href={menuHref}>
                  {t(resolvedLang, "home.featured.view")}
                </a>
              </div>
            </div>
          </article>
        </div>
      ))}
    </div>
  );
}
