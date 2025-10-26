"use client";

import { useState, useMemo, useEffect, useState as useReactState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTenantId } from "@/lib/tenant/context";
import { tenantPath } from '@/lib/tenant/paths';

/* 🔹 Firebase client (init) + Firestore */
import "@/lib/firebase/client";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "firebase/firestore";

export default function AuthNavbar() {
  const [open, setOpen] = useState(false);
  const tenantId = useTenantId();

  /* 🔹 Nombre de marca derivado de tenantOrders */
  const [brandName, setBrandName] = useReactState<string>("OrderCraft");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!tenantId) return;
        const db = getFirestore();
        const colRef = collection(db, "tenants", tenantId, "tenantOrders");
        const q = query(colRef, orderBy("createdAt", "desc"), limit(1));
        const snap = await getDocs(q);
        const data = snap.docs[0]?.data() as any | undefined;
        const name = data?.customer?.name?.toString()?.trim();
        if (!cancelled && name) setBrandName(name);
      } catch {
        // Silencioso: mantenemos fallback
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  const withTenant = useMemo(() => {
    return (p: string) => {
      const norm = p.startsWith('/') ? p : `/${p}`;
      if (!tenantId) return norm;

      // Si ya viene como "/{tenantId}/..." no dupliques
      if (norm === `/${tenantId}` || norm.startsWith(`/${tenantId}/`)) return norm;

      // Construye la ruta correcta (wildcard vs local)
      return tenantPath(tenantId, norm);
    };
  }, [tenantId]);

  const logoSrc = useMemo(() => withTenant("/logo-mark.svg"), [withTenant]);

  return (
    <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
      <div className="container">
        <Link className="navbar-brand d-flex align-items-center gap-2" href={withTenant("/app")}>
          <Image src={logoSrc} alt="Logo" width={28} height={28} />
          {/* 🔹 Reemplazo de texto fijo por brandName */}
          <span className="fw-semibold">{brandName}</span>
        </Link>

        <button
          className="navbar-toggler"
          type="button"
          aria-controls="authNav"
          aria-expanded={open ? "true" : "false"}
          aria-label="Toggle navigation"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="navbar-toggler-icon"></span>
        </button>

        <div className={`collapse navbar-collapse ${open ? "show" : ""}`} id="authNav">
          <ul className="navbar-nav me-auto mb-2 mb-md-0">
            <li className="nav-item">
              <Link className="nav-link" href={withTenant("/app/menu")} onClick={() => setOpen(false)}>
                Menu
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}
