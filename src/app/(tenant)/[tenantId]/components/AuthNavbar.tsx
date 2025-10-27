"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useTenantId } from "@/lib/tenant/context";
import { tenantPath } from '@/lib/tenant/paths';

export default function AuthNavbar({ brandName = "" }: { brandName?: string }) {
  const [open, setOpen] = useState(false);
  const tenantId = useTenantId();

  const withTenant = useMemo(() => {
    return (p: string) => {
      const norm = p.startsWith('/') ? p : `/${p}`;
      if (!tenantId) return norm;
      if (norm === `/${tenantId}` || norm.startsWith(`/${tenantId}/`)) return norm;
      return tenantPath(tenantId, norm);
    };
  }, [tenantId]);

  const logoSrc = useMemo(() => withTenant("/logo-mark.svg"), [withTenant]);

  return (
    <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
      <div className="container">
        <Link className="navbar-brand d-flex align-items-center gap-2" href={withTenant("/app")}>
          <Image src={logoSrc} alt="Logo" width={28} height={28} />
          <span className="fw-semibold">{brandName || '\u00A0'}</span>
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
