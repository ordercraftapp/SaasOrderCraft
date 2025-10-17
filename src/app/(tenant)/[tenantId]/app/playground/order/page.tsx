"use client";

import "@/lib/firebase/client";
import { useEffect, useMemo, useState } from "react";
import { getAuth } from "firebase/auth";
import { useAuth } from "@/app/(tenant)/[tenantId]/app/providers";
import { useFmtQ } from "@/lib/settings/money";
import { useParams } from "next/navigation";

/* ---------- hook pequeño para leer el tenantId del segmento ---------- */
function useTenantId() {
  const p = useParams();
  // soporta [tenantId] o [tenant] por si coexistieran
  return (p?.tenantId as string) || (p?.tenant as string) || "";
}

/* ------------ helper para llamadas autenticadas + tenant ------------ */
async function apiFetch(path: string, init?: RequestInit, tenantId?: string) {
  const auth = getAuth();
  const user = auth.currentUser;
  const headers: HeadersInit = { ...(init?.headers || {}) };
  if (user) {
    const token = await user.getIdToken();
    (headers as any)["Authorization"] = `Bearer ${token}`;
  }
  if (tenantId) {
    // (antes) (headers as any)["x-tenant-id"] = tenantId; // 🔑 importante para las APIs
    (headers as any)["x-tenant"] = tenantId; // 🔑 unificamos el header con el resto del app
  }
  return fetch(path, { ...init, headers });
}

/* -------------------- Tipos mínimos -------------------- */
type MenuItem = {
  id: string;
  name: string;
  description?: string | null;
  price?: number | null;
  priceCents?: number | null;
  currency?: string | null;
  isActive?: boolean | null;
  sortOrder?: number | null;
};

type CartLine = {
  itemId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  totalCents: number;
};

type OrderType = "dine_in" | "takeaway" | "delivery";

/* -------------------- Componente -------------------- */
export default function OrderPlaygroundPage() {
  const tenantId = useTenantId();
  const { user } = useAuth(); // controla visibilidad de Delivery
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("dine_in");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const fmtQ = useFmtQ();

  /* Cargar menú desde /api/menu (tenant-aware) */
  useEffect(() => {
    let on = true;
    setLoading(true);
    // (antes) apiFetch("/api/menu?limit=100", undefined, tenantId)
    apiFetch(`/${tenantId}/app/api/menu?limit=100`, undefined, tenantId)
      .then((r) => r.json())
      .then((data) => {
        if (!on) return;
        const arr = Array.isArray(data?.items) ? data.items : [];
        setItems(arr);
      })
      .catch((e) => console.error(e))
      .finally(() => on && setLoading(false));
    return () => {
      on = false;
    };
  }, [tenantId]);

  /* Helpers de carrito */
  function addToCart(mi: MenuItem) {
    const priceCents =
      typeof mi.priceCents === "number"
        ? mi.priceCents
        : typeof mi.price === "number"
        ? Math.round(mi.price * 100)
        : 0;

    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === mi.id);
      if (idx === -1) {
        const newline: CartLine = {
          itemId: mi.id,
          name: mi.name,
          qty: 1,
          unitPriceCents: priceCents,
          totalCents: priceCents,
        };
        return [...prev, newline];
      } else {
        const next = [...prev];
        const line = { ...next[idx] };
        line.qty += 1;
        line.totalCents = line.qty * line.unitPriceCents;
        next[idx] = line;
        return next;
      }
    });
  }

  function decQty(itemId: string) {
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.itemId === itemId);
      if (idx === -1) return prev;
      const next = [...prev];
      const line = { ...next[idx] };
      line.qty -= 1;
      if (line.qty <= 0) {
        next.splice(idx, 1);
        return next;
      }
      line.totalCents = line.qty * line.unitPriceCents;
      next[idx] = line;
      return next;
    });
  }

  const totalCents = useMemo(
    () => cart.reduce((acc, l) => acc + l.totalCents, 0),
    [cart]
  );

  /* ✅ Enviar orden: payload con `lines` y header x-tenant */
  async function submitOrder() {
    setSubmitting(true);
    setErrorMsg(null);
    setOkMsg(null);
    try {
      if (cart.length === 0) {
        setErrorMsg("Your cart is empty.");
        return;
      }
      if (orderType === "delivery" && !user) {
        setErrorMsg("You must log in to create a delivery order.");
        return;
      }

      const payload = {
        type: orderType,
        lines: cart.map((l) => ({
          itemId: l.itemId,
          name: l.name,
          qty: l.qty,
          unitPriceCents: l.unitPriceCents,
          totalCents: l.totalCents,
        })),
      };

      // (antes) apiFetch("/api/orders", { ... }, tenantId)
      const res = await apiFetch(
        `/${tenantId}/app/api/orders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        tenantId
      );

      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setErrorMsg(data?.error || "The order could not be created.");
        return;
      }

      setOkMsg(`Order created: ${data?.order?.id || "(sin id)"}`);
      setCart([]);
    } catch (e: any) {
      setErrorMsg(e?.message || "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: "40px auto", padding: 16 }}>
      <h1>Build order</h1>

      {/* Radios de tipo de orden: Delivery solo si hay usuario */}
      <div style={{ display: "flex", gap: 16, margin: "12px 0 24px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="radio"
            name="orderType"
            value="dine_in"
            checked={orderType === "dine_in"}
            onChange={() => setOrderType("dine_in")}
          />
          Dine-in
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="radio"
            name="orderType"
            value="takeaway"
            checked={orderType === "takeaway"}
            onChange={() => setOrderType("takeaway")}
          />
          Takeaway
        </label>
        {user && (
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="radio"
              name="orderType"
              value="delivery"
              checked={orderType === "delivery"}
              onChange={() => setOrderType("delivery")}
            />
            Delivery (requires login)
          </label>
        )}
      </div>

      {loading ? (
        <p>Loading menu…</p>
      ) : (
        <>
          <h2>Menu</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
            {items
              .filter((i) => i.isActive !== false)
              .sort(
                (a, b) =>
                  Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
                  String(a.name || "").localeCompare(String(b.name || ""))
              )
              .map((mi) => {
                const p =
                  typeof mi.priceCents === "number"
                    ? mi.priceCents / 100
                    : typeof mi.price === "number"
                    ? mi.price
                    : 0;
                return (
                  <div key={mi.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600 }}>{mi.name}</div>
                    {mi.description && (
                      <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{mi.description}</div>
                    )}
                    <div style={{ marginTop: 8, fontWeight: 600 }}>{fmtQ(p)}</div>
                    <button
                      onClick={() => addToCart(mi)}
                      style={{
                        marginTop: 8,
                        border: "1px solid #111",
                        background: "#111",
                        color: "#fff",
                        borderRadius: 6,
                        padding: "6px 10px",
                        cursor: "pointer",
                      }}
                    >
                      Add
                    </button>
                  </div>
                );
              })}
          </div>

          <h2 style={{ marginTop: 24 }}>Cart</h2>
          {cart.length === 0 ? (
            <p>There are no items in the cart..</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>Product</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: 8 }}>Qty.</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: 8 }}>Unit.</th>
                  <th style={{ textAlign: "right", borderBottom: "1px solid #ddd", padding: 8 }}>Total</th>
                  <th style={{ borderBottom: "1px solid #ddd", padding: 8 }}></th>
                </tr>
              </thead>
              <tbody>
                {cart.map((l) => (
                  <tr key={l.itemId}>
                    <td style={{ padding: 8 }}>{l.name}</td>
                    <td style={{ textAlign: "right", padding: 8 }}>{l.qty}</td>
                    <td style={{ textAlign: "right", padding: 8 }}>{fmtQ(l.unitPriceCents / 100)}</td>
                    <td style={{ textAlign: "right", padding: 8 }}>{fmtQ(l.totalCents / 100)}</td>
                    <td style={{ padding: 8 }}>
                      <button
                        onClick={() => decQty(l.itemId)}
                        style={{ border: "1px solid #999", padding: "4px 8px", borderRadius: 4 }}
                      >
                        -1
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3} style={{ textAlign: "right", padding: 8, fontWeight: 700 }}>
                    Total
                  </td>
                  <td style={{ textAlign: "right", padding: 8, fontWeight: 700 }}>{fmtQ(totalCents / 100)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          )}

          {errorMsg && <div style={{ marginTop: 12, color: "#b91c1c" }}>{errorMsg}</div>}
          {okMsg && <div style={{ marginTop: 12, color: "#15803d" }}>{okMsg}</div>}

          <div style={{ marginTop: 16 }}>
            <button
              disabled={submitting || cart.length === 0}
              onClick={submitOrder}
              style={{
                border: "1px solid #111",
                background: submitting ? "#666" : "#111",
                color: "#fff",
                borderRadius: 8,
                padding: "10px 14px",
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Sending…" : "Confirm order"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
