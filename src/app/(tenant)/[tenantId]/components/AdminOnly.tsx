"use client";

import { useEffect, useState } from "react";
import { useTenantId } from "@/lib/tenant/context";
import { useAuth } from "@/app/(tenant)/[tenantId]/app/providers";

type ApiRefreshRoleResp =
  | { ok: true; tenantId: string; role: "admin" | "kitchen" | "cashier" | "waiter" | "delivery" | "customer" }
  | { ok: false; error?: string };

export default function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const tenantId = useTenantId();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!tenantId) { setErr("Missing tenant"); setChecking(false); return; }
      if (loading) return;
      if (!user) { setAllowed(false); setChecking(false); return; }

      try {
        const idToken = await user.getIdToken(true);
        const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
          cache: "no-store",
        });
        const data = (await resp.json().catch(() => ({}))) as ApiRefreshRoleResp;
        if (!alive) return;

        if (!resp.ok || data.ok !== true) {
          setErr((!data.ok && "error" in data && data.error) ? data.error! : `HTTP ${resp.status}`);
          setAllowed(false);
        } else {
          setAllowed(data.role === "admin");
        }
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message || "Role check failed");
        setAllowed(false);
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => { alive = false; };
  }, [tenantId, user, loading]);

  if (checking) {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: "40vh" }}>
        <div className="text-center">
          <div className="spinner-border" role="status" aria-label="Loading" />
          <div className="mt-2 text-muted">Validating admin access…</div>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-6">
            <div className="card shadow-sm border-0">
              <div className="card-body p-4 text-center">
                <div className="display-6 mb-2">⛔</div>
                <h5 className="card-title mb-2">Access denied</h5>
                <p className="text-muted mb-2">You don’t have admin permissions for this tenant.</p>
                {err && <p className="text-danger small mb-0">{err}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
