"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getFirestore,
  query,
  where,
  onSnapshot,
  getDoc,
  doc,
  orderBy,
  getDocs,
  limit,
} from "firebase/firestore";
import Image from "next/image";
import Link from "next/link";

import { useTenantSettings } from "@/lib/settings/hooks";
import { t as translate } from "@/lib/i18n/t";
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
  const tenantId = useTenantId();
  const [category, setCategory] = useState<Category | null>(null);
  const [subcats, setSubcats] = useState<Subcategory[]>([]);
  const [loading, setLoading] = useState(true);

  // i18n
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

  const withTenant = (p: string) => {
    if (!tenantId) return p;
    const norm = p.startsWith("/") ? p : `/${p}`;
    if (norm.startsWith(`/${tenantId}/`)) return norm;
    return `/${tenantId}${norm}`;
  };

  useEffect(() => {
    if (!tenantId) return;

    let unsubSubcats: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        // 1) Intentar resolver categoría por ID directo
        let catSnap = await getDoc(doc(tCol("categories", tenantId), catId));

        // 2) Si no existe, intentar por slug == catId
        if (!catSnap.exists()) {
          const qBySlug = query(
            tCol("categories", tenantId),
            where("slug", "==", catId),
            limit(1)
          );
          const snapSlug = await getDocs(qBySlug);
          if (!snapSlug.empty) {
            catSnap = snapSlug.docs[0];
          }
        }

        if (!catSnap.exists()) {
          // No se encontró ni por id ni por slug
          setCategory(null);
          setSubcats([]);
          setLoading(false);
          return;
        }

        const catData = { id: catSnap.id, ...(catSnap.data() as any) } as Category;
        setCategory(catData);

        // 3) Suscripción a subcategorías por categoryId == ID REAL
        const qSubBase = query(
          tCol("subcategories", tenantId),
          where("categoryId", "==", catData.id)
        );

        // Preferimos con orderBy(sortOrder)…
        try {
          const qSub = query(qSubBase, orderBy("sortOrder", "asc"));
          unsubSubcats = onSnapshot(qSub, (s) => {
            if (cancelled) return;
            const rows = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            setSubcats(rows);
            setLoading(false);
          });
        } catch {
          // …si falla (p. ej. índice), hacemos fallback sin orderBy
          unsubSubcats = onSnapshot(qSubBase, (s) => {
            if (cancelled) return;
            const rows = s.docs
              .map((d) => ({ id: d.id, ...(d.data() as any) }))
              .sort(
                (a, b) =>
                  (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) ||
                  String(a.name || "").localeCompare(String(b.name || ""))
              );
            setSubcats(rows);
            setLoading(false);
          });
        }
      } catch (e) {
        if (!cancelled) {
          console.error("[CategoryClient] error:", e);
          setCategory(null);
          setSubcats([]);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unsubSubcats) {
        try { unsubSubcats(); } catch {}
      }
    };
  }, [db, catId, tenantId]);

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">{category?.name ?? tt("menu.category.title", "Category")}</h1>
        <Link href={withTenant("/app/menu")} className="btn btn-sm btn-outline-secondary">
          ← {tt("menu.category.back", "Back")}
        </Link>
      </div>

      {loading && (
        <div className="text-muted mb-3">{tt("menu.category.loading", "Loading subcategories…")}</div>
      )}

      <div className="row g-4">
        {subcats.map((sub, i) => (
          <div className="col-12 col-sm-6 col-lg-3" key={sub.id}>
            <Link href={withTenant(`/app/menu/${category?.id ?? catId}/${sub.id}`)} className="text-decoration-none">
              <div className="card border-0 shadow-sm h-100 position-relative">
                <div className="ratio ratio-16x9 rounded-top overflow-hidden">
                  {sub.imageUrl ? (
                    <Image
                      src={sub.imageUrl}
                      alt={sub.name}
                      fill
                      sizes="(max-width: 576px) 100vw, (max-width: 992px) 50vw, 25vw"
                      className="object-fit-cover"
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

        {!loading && subcats.length === 0 && (
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
