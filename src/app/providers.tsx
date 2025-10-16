// src/app/providers.tsx
"use client";

import {
  onIdTokenChanged,
  getIdTokenResult,
  User,
} from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import { CartProvider } from "@/lib/cart/context";

// ----------------------
// Auth Context
// ----------------------
type Claims = {
  admin?: boolean;
  kitchen?: boolean;
  waiter?: boolean;
  delivery?: boolean;
  cashier?: boolean;
  role?: string;
  [k: string]: any;
};

type RoleFlags = {
  isAdmin: boolean;
  isKitchen: boolean;
  isWaiter: boolean;
  isDelivery: boolean;
  isCashier: boolean;
  isCustomer: boolean;
};

type Ctx = {
  user: User | null;
  loading: boolean;
  idToken: string | null;
  claims: Claims | null;
  flags: RoleFlags;
  /** Fuerza refresh del ID token y claims (útil tras cambiar roles) */
  refreshRoles: () => Promise<void>;
};

const defaultFlags: RoleFlags = {
  isAdmin: false,
  isKitchen: false,
  isWaiter: false,
  isDelivery: false,
  isCashier: false,
  isCustomer: true,
};

const AuthContext = createContext<Ctx>({
  user: null,
  loading: true,
  idToken: null,
  claims: null,
  flags: defaultFlags,
  refreshRoles: async () => {},
});

/* ============================
   🔹 Helpers de URL tenant-aware
   ============================ */
function getTenantIdFromLocation(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const parts = (window.location.pathname || "/").split("/").filter(Boolean);
    // Esperamos rutas tipo: /{tenantId}/app/...
    return parts.length >= 1 ? parts[0] || null : null;
  } catch {
    return null;
  }
}
function tenantApiPath(p: string): string {
  // p debe empezar con "/api/..." o "/app/..."
  const rel = p.startsWith("/") ? p : `/${p}`;
  const tenantId = getTenantIdFromLocation();
  if (!tenantId) return rel.startsWith("/app") ? rel : `/app${rel}`; // fallback sin tenant
  if (rel.startsWith(`/${tenantId}/`)) return rel; // ya viene con tenant
  if (rel.startsWith("/api/")) return `/${tenantId}/app${rel}`;
  if (rel.startsWith("/app/")) return `/${tenantId}${rel}`;
  // fallback
  return `/${tenantId}${rel}`;
}

// --- Helpers para cookie de rol leída por el middleware ---
async function syncRoleCookie(idToken: string) {
  try {
    const path = tenantApiPath("/api/auth/refresh-role");
    const url = typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path;
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    // Silencioso: si falla, el middleware tratará al usuario como customer.
  }
}

function clearRoleCookies() {
  try {
    // Las cookies NO son httpOnly para que middleware pueda leerlas y también poder limpiarlas aquí
    document.cookie = "appRole=; Max-Age=0; Path=/";
    document.cookie = "isOp=; Max-Age=0; Path=/";
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [claims, setClaims] = useState<Claims | null>(null);
  const [flags, setFlags] = useState<RoleFlags>(defaultFlags);
  const [loading, setLoading] = useState(true);

  const computeFlags = useCallback((c: Claims | null): RoleFlags => {
    const isAdmin = !!c?.admin || c?.role === "admin";
    const isKitchen = !!c?.kitchen || isAdmin;
    const isWaiter = !!c?.waiter || isAdmin;
    const isDelivery = !!c?.delivery || isAdmin;
    const isCashier = !!c?.cashier || c?.role === "cashier" || isAdmin;
    const isCustomer = !isAdmin && !isKitchen && !isWaiter && !isDelivery && !isCashier;

    return {
      isAdmin,
      isKitchen,
      isWaiter,
      isDelivery,
      isCashier,
      isCustomer,
    };
  }, []);

  const hydrate = useCallback(
    async (u: User | null, force = false) => {
      if (!u) {
        setUser(null);
        setIdToken(null);
        setClaims(null);
        setFlags(defaultFlags);
        clearRoleCookies(); // Evita que quede una cookie operativa tras logout
        setLoading(false);
        return;
      }
      try {
        const token = await u.getIdToken(force);
        const res = await getIdTokenResult(u, force);
        const c = (res.claims || {}) as Claims;

        setUser(u);
        setIdToken(token);
        setClaims(c);
        setFlags(computeFlags(c));

        // Mantener cookie de rol sincronizada para el middleware
        await syncRoleCookie(token);
      } catch {
        setIdToken(null);
        setClaims(null);
        setFlags(defaultFlags);
      } finally {
        setLoading(false);
      }
    },
    [computeFlags]
  );

  useEffect(() => {
    // onIdTokenChanged cubre sign-in, sign-out y refresh de token/claims
    const unsub = onIdTokenChanged(auth, (u) => {
      // no forzamos aquí; si cambian claims por server, usa refreshRoles()
      hydrate(u, false);
    });
    return () => unsub();
  }, [hydrate]);

  const refreshRoles = useCallback(async () => {
    const u = auth.currentUser;
    await hydrate(u, true);
  }, [hydrate]);

  // ⬇️ Welcome email (idempotente en server)
  useEffect(() => {
    if (loading) return;
    if (!user || !idToken) return;

    const key = `oc-welcome-v1:${user.uid}`;
    try {
      if (typeof window !== "undefined" && window.sessionStorage.getItem(key)) return;
      if (typeof window !== "undefined") window.sessionStorage.setItem(key, "1");
    } catch {}

    (async () => {
      try {
        // GET /{tenantId}/app/api/customers/me
        {
          const path = tenantApiPath("/api/customers/me");
          const url = typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path;
          await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${idToken}` },
            cache: "no-store",
            credentials: "same-origin",
          });
        }

        // POST /{tenantId}/app/api/tx/welcome
        {
          const path = tenantApiPath("/api/tx/welcome");
          const url = typeof window !== "undefined" ? new URL(path, window.location.origin).toString() : path;
          await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${idToken}`,
              "content-type": "application/json",
            },
            credentials: "same-origin",
            cache: "no-store",
          });
        }
      } catch {
        // silencioso
      }
    })();
  }, [user, idToken, loading]);

  const value = useMemo<Ctx>(
    () => ({ user, loading, idToken, claims, flags, refreshRoles }),
    [user, loading, idToken, claims, flags, refreshRoles]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// ----------------------
// Root Providers Wrapper
// ----------------------
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <CartProvider>{children}</CartProvider>
    </AuthProvider>
  );
}
