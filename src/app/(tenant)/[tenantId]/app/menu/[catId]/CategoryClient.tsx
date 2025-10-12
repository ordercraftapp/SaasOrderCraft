"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getFirestore,
  // collection, // ⛔️ old (global, sin tenant) — ahora usamos tCol(...)
  query,
  where,
  onSnapshot,
  getDoc,
  doc,
  orderBy,
} from "firebase/firestore";
import Image from "next/image";
import Link from "next/link";

// 🔤 i18n
import { useTenantSettings } from "@/lib/settings/hooks";
import { t as translate } from "@/lib/i18n/t";

/* ✅ Multi-tenant (cliente) */
import { useTenantId } from "@/lib/tenant/context";
import { tCol } from "@/lib/db";

type Category = { id: string; name: string; slug?: string; imageUrl?: string | null };
type Subcategory = {
  id: string;
  name: string;
  slug?: string;
  sortOrder?: number;
  imageUrl?: string | null;
  categoryId: string;
};

export default function CategoryClient({ catId }: { catId: string }) {
  const db = useMemo(() => getFirestore(), []);
  const tenantId = useTenantId(); // ✅ tenant actual
  const [category, setCategory] = useState<Category | null>(null);
  const [subcats, setSubcats] = useState<Subcategory[]>([]);

  // 🔤 idioma actual + helper
  const { settings } = useTenantSettings();
  const lang = useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const ls = localStorage.getItem("tenant.language");
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  // Helper: prefija rutas con /{tenantId}
  const withTenant = (p: string) => {
    if (!tenantId) return p; // fallback visual mientras carga el contexto
    const norm = p.startsWith("/") ? p : `/${p}`;
    if (norm.startsWith(`/${tenantId}/`)) return norm;
    return `/${tenantId}${norm}`;
  };

  useEffect(() => {
    if (!tenantId) return; // espera contexto tenant
    const unsubList: Array<() => void> = [];

    (async () => {
      // ⛔️ OLD (global):
      // const snap = await getDoc(doc(db, "categories", catId));
      // ✅ NEW (scoped): tenants/{tenantId}/categories/{catId}
      const snap = await getDoc(doc(tCol("categories", tenantId), catId));
      if (snap.exists()) setCategory({ id: snap.id, ...(snap.data() as any) });

      // ⛔️ OLD (global):
      // const qSub = query(
      //   collection(db, "subcategories"),
      //   where("categoryId", "==", catId),
      //   orderBy("sortOrder", "asc")
      // );
      // ✅ NEW (scoped): tenants/{tenantId}/subcategories (mismo filtro/orden)
      const qSub = query(
        tCol("subcategories", tenantId),
        where("categoryId", "==", catId),
        orderBy("sortOrder", "asc")
      );

      const unsub = onSnapshot(qSub, (s) => {
        const rows = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        setSubcats(rows);
      });
      unsubList.push(unsub);
    })();

    return () => unsubList.forEach((u) => { try { u(); } catch {} });
  }, [db, catId, tenantId]);

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">{category?.name ?? tt("menu.category.title", "Category")}</h1>
        {/* ⛔️ OLD: <Link href="/menu" ...> */}
        <Link href={withTenant("/app/menu")} className="btn btn-sm btn-outline-secondary">
          ← {tt("menu.category.back", "Back")}
        </Link>
      </div>

      <div className="row g-4">
        {subcats.map((sub, i) => (
          <div className="col-12 col-sm-6 col-lg-3" key={sub.id}>
            {/* ⛔️ OLD: href={`/menu/${catId}/${sub.id}`} */}
            <Link href={withTenant(`/app/menu/${catId}/${sub.id}`)} className="text-decoration-none">
              <div className="card border-0 shadow-sm h-100 position-relative">
                <div className="ratio ratio-16x9 rounded-top overflow-hidden">
                  {sub.imageUrl ? (
                    <Image
                      src={sub.imageUrl}
                      alt={sub.name}
                      fill
                      sizes="(max-width: 576px) 100vw, (max-width: 992px) 50vw, 25vw"
                      className="object-fit-cover"
                      // prioridad solo a la primera imagen en grid (micro-perf percibida)
                      priority={i < 1}
                    />
                  ) : (
                    <div className="d-flex align-items-center justify-content-center bg-light text-muted">
                      {tt("menu.category.noImage", "No image")}
                    </div>
                  )}
                </div>
                <div className="card-img-overlay d-flex align-items-end p-0">
                  <div className="w-100 bg-white px-3 py-3 border-top">
                    <div className="fw-semibold text-dark">{sub.name}</div>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        ))}

        {subcats.length === 0 && (
          <div className="col-12">
            <div className="alert alert-light border">
              {tt("menu.category.empty", "There are no subcategories in this category yet.")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
