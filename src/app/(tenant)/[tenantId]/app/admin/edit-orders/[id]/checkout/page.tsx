// src/app/(tenant)/[tenant]/app/admin/edit-orders/[id]/checkout/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useEditCart } from "@/lib/edit-cart/context";
import { apiFetch } from "@/lib/api/client";
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import { RoleGate } from '@/app/(tenant)/[tenantId]/components/RoleGate'; // allow={['admin','waiter']}

/* 🔐 Gate por plan (Pro/Full) */
import ToolGate from "@/components/ToolGate";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

export default function EditCheckoutPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { cart, resetAll } = useEditCart();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔤 i18n init
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

  // Calcula amounts con los mismos campos que usas al crear órdenes
  const amounts = useMemo(() => {
    const subtotal = (cart.lines ?? []).reduce((acc, l) => {
      const price =
        typeof l.unitPriceCents === "number" && Number.isFinite(l.unitPriceCents)
          ? l.unitPriceCents
          : 0;
      const qty =
        typeof l.quantity === "number" && Number.isFinite(l.quantity)
          ? l.quantity
          : 1;
      return acc + price * qty;
    }, 0);
    const tip = cart.tipCents ?? 0;
    return {
      subtotalCents: subtotal,
      taxCents: 0,
      serviceFeeCents: 0,
      discountCents: 0,
      tipCents: tip,
      totalCents: subtotal + tip,
    };
  }, [cart.lines, cart.tipCents]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      items: (cart.lines ?? []).map((l) => ({
        menuItemId: String(l.menuItemId ?? ""),
        name: l.name, // asegura nombre en la orden
        quantity:
          typeof l.quantity === "number" && Number.isFinite(l.quantity)
            ? l.quantity
            : 1,
        unitPriceCents:
          typeof l.unitPriceCents === "number" && Number.isFinite(l.unitPriceCents)
            ? l.unitPriceCents
            : 0,
        options: (l.selections ?? []).map((g) => ({
          groupId: g.groupId,
          optionItemIds: g.optionItemIds,
        })),
      })),
      currency: cart.currency ?? "GTQ",
      type: cart.type ?? "dine_in",
      tableNumber: (cart.tableNumber ?? "").trim(),
      notes: cart.notes ?? "",
      amounts, // {subtotalCents, taxCents, serviceFeeCents, discountCents, tipCents, totalCents}
    };

    const res = await apiFetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      setError(tt('admin.editcheckout.err.unauth', 'Unauthorized. Sign in..'));
      setSaving(false);
      router.replace("/login");
      return;
    }
    if (!res.ok) {
      const t = await res.text();
      setError(`${tt('admin.editcheckout.err.save', 'Error saving changes')}: ${t}`);
      setSaving(false);
      return;
    }

    resetAll(); // limpiar el carrito de edición
    router.replace("/admin/edit-orders");
  }

  const currency = cart.currency ?? "GTQ";

  return (
    <Protected>
      <RoleGate allow={['admin','waiter']}>
        <ToolGate feature="editOrders">
          <div className="container py-3">
            <div className="alert alert-warning mb-3">
              {tt('admin.editcheckout.banner', 'Edit order')}{' '}
              <strong>#{(cart.orderId ?? "").slice(-6).toUpperCase()}</strong>
            </div>

            <h2 className="h6 mb-3">{tt('admin.editcheckout.confirm', 'Confirm changes')}</h2>

            <form onSubmit={handleSubmit} className="vstack gap-3">
              <div className="card">
                <div className="card-body">
                  <div className="mb-2">
                    {tt('admin.editcheckout.items', 'Items')}: <strong>{(cart.lines ?? []).length}</strong>
                  </div>
                  <div className="mb-2">
                    {tt('common.subtotal', 'Subtotal')}:{" "}
                    <strong>
                      {(amounts.subtotalCents / 100).toFixed(2)} {currency}
                    </strong>
                  </div>
                  <div className="mb-2">
                    {tt('common.tip', 'Tip')}:{" "}
                    <strong>
                      {(amounts.tipCents / 100).toFixed(2)} {currency}
                    </strong>
                  </div>
                  <div className="mb-2">
                    {tt('common.total', 'Total')}:{" "}
                    <strong>
                      {(amounts.totalCents / 100).toFixed(2)} {currency}
                    </strong>
                  </div>
                </div>
              </div>

              {error && <div className="alert alert-danger">{error}</div>}

              <div className="d-flex gap-2">
                <button className="btn btn-success" disabled={saving}>
                  {tt('admin.editcheckout.save', 'Save changes')}
                </button>
                <button
                  className="btn btn-outline-secondary"
                  type="button"
                  onClick={() => history.back()}
                  disabled={saving}
                >
                  {tt('common.back', 'Back')}
                </button>
              </div>
            </form>
          </div>
        </ToolGate>
      </RoleGate>
    </Protected>
  );
}
