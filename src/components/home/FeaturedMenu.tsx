// src/components/home/FeaturedMenu.tsx
"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { t } from "@/lib/i18n/t";

type Item = { id: string; name: string; price?: number; imageUrl?: string };

export default function FeaturedMenu({
  items,
  lang,
}: {
  items: Item[];
  lang?: string; // ← opcional; si no llega, resolvemos desde localStorage
}) {
  const [clientLang, setClientLang] = useState<string | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tenant.language");
      if (raw) setClientLang(raw);
    } catch {}
  }, []);
  const resolvedLang = lang || clientLang || "es";

  if (!items?.length) {
    return <div className="text-muted">{t(resolvedLang, "home.featured.empty")}</div>;
  }

  return (
    <div className="row g-3">
      {items.map((it) => (
        <div className="col-12 col-sm-6 col-lg-4" key={it.id}>
          <article className="card h-100 shadow-sm">
            <div className="ratio ratio-4x3">
              <Image
                src={it.imageUrl || "/menu-fallback.jpg"}
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
                <a className="btn btn-outline-secondary" href={`/menu`}>
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
