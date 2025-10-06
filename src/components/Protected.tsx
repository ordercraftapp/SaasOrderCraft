// src/components/Protected.tsx
"use client";

import { useAuth } from "@/app/providers";
import Link from "next/link";
import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Props = {
  children: React.ReactNode;
  /** Activa redirección automática a /login cuando no hay sesión */
  redirect?: boolean; // default: false (mantiene el comportamiento actual)
};

export default function Protected({ children, redirect = false }: Props) {
  // ⬇️ Agregamos Suspense aquí para cubrir los hooks usados en Gate
  return (
    <Suspense
      fallback={
        <div className="d-flex align-items-center justify-content-center" style={{ minHeight: "40vh" }}>
          <div className="text-center">
            <div className="spinner-border" role="status" aria-label="Cargando" />
            <div className="mt-2 text-muted">Loading…</div>
          </div>
        </div>
      }
    >
      <Gate redirect={redirect}>{children}</Gate>
    </Suspense>
  );
}

function Gate({ children, redirect = false }: Props) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Ruta de login (evita bucles si por error envuelven /login)
  const isLoginRoute = pathname === "/login" || pathname?.startsWith("/login/");
  const search = searchParams?.toString();
  const next = pathname + (search ? `?${search}` : "");

  // Redirección opcional a /login?next=<ruta-actual>
  useEffect(() => {
    if (!redirect) return;
    if (loading) return;
    if (isLoginRoute) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [redirect, loading, user, pathname, searchParams, router, isLoginRoute, next]);

  // Loading UI (spinner Bootstrap)
  if (loading) {
    return (
      <div className="d-flex align-items-center justify-content-center" style={{ minHeight: "40vh" }}>
        <div className="text-center">
          <div className="spinner-border" role="status" aria-label="Loading" />
          <div className="mt-2 text-muted">Loading…</div>
        </div>
      </div>
    );
  }

  // Sin sesión
  if (!user) {
    // Con redirect: ya disparamos router.replace → no renderizamos
    if (redirect && !isLoginRoute) return null;

    // Sin redirect: mostramos tarjeta con estilos Bootstrap + botón de login
    return (
      <div className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-md-8 col-lg-6">
            <div className="card shadow-sm border-0">
              <div className="card-body p-4 text-center">
                <div className="display-6 mb-2">🔒</div>
                <h5 className="card-title mb-2">You need to Login</h5>
                <p className="text-muted mb-4">
                  To continue, please log in to your account.
                </p>

                <Link
                  href={`/login?next=${encodeURIComponent(next)}`}
                  className="btn btn-primary btn-lg"
                >
                  Login
                </Link>

                <div className="mt-3">
                  <button
                    type="button"
                    className="btn btn-link"
                    onClick={() => router.refresh()}
                  >
                    Re-try
                  </button>
                </div>
              </div>
            </div>

            <p className="text-center text-muted small mt-3 mb-0">
              If you don't have an account, request access from the administrator,
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Autenticado: render normal
  return <>{children}</>;
}
