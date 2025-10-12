// src/app/(tenant)/[tenantId]/components/AuthNavbar.tsx
"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTenantId } from "@/lib/tenant/context";

export default function AuthNavbar() {
  const [open, setOpen] = useState(false);
  const tenantId = useTenantId();

  const withTenant = useMemo(() => {
    return (p: string) => {
      const norm = p.startsWith("/") ? p : `/${p}`;
      if (!tenantId) return norm;
      const base = `/_t/${tenantId}`;
      return norm.startsWith(`${base}/`) || norm === base ? norm : `${base}${norm}`;
    };
  }, [tenantId]);

  const logoSrc = useMemo(() => withTenant("/logo-mark.svg"), [withTenant]);

  return (
    <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
      <div className="container">
        <Link className="navbar-brand d-flex align-items-center gap-2" href={withTenant("/")}>
          <Image src={logoSrc} alt="Logo" width={28} height={28} />
          <span className="fw-semibold">OrderCraft</span>
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
              <Link className="nav-link" href={withTenant("/menu")} onClick={() => setOpen(false)}>
                Menu
              </Link>
            </li>
            <li className="nav-item">
              <Link className="nav-link" href={withTenant("/promos")} onClick={() => setOpen(false)}>
                Promotions
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  );
}
