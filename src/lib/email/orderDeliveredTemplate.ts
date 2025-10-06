// src/lib/email/orderDeliveredTemplate.ts
import "server-only";

const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://ordercraft.datacraftcoders.com";

type OptionItem = { name?: string; price?: number; priceCents?: number; priceDelta?: number; priceDeltaCents?: number; priceExtra?: number; priceExtraCents?: number };
type OrderItemLine = {
  menuItemName?: string;
  quantity?: number;
  optionGroups?: Array<{ groupName?: string; items?: OptionItem[] }>;
  options?: Array<{ groupName?: string; selected?: OptionItem[] }>;
  addons?: Array<any>;
  extras?: Array<any>;
  modifiers?: Array<any>;
  basePrice?: number;
  basePriceCents?: number;
  price?: number;
  priceCents?: number;
  unitPrice?: number;
  unitPriceCents?: number;
  totalCents?: number;
};
type Totals = {
  subtotal?: number; deliveryFee?: number; tip?: number; discount?: number; currency?: string;
  totalCents?: number; subtotalCents?: number; taxCents?: number; serviceFeeCents?: number; discountCents?: number;
};
type OrderDoc = {
  id: string;
  orderNumber?: string;
  status?: string;
  items?: OrderItemLine[];
  lines?: OrderItemLine[];
  totals?: Totals;
  amounts?: { subtotal?: number; serviceFee?: number; discount?: number; tax?: number; tip?: number; total?: number };
  orderTotal?: number;
  createdAt?: any;
  orderInfo?: {
    type?: 'dine-in' | 'delivery' | 'pickup';
    table?: string;
    notes?: string;
    address?: string;
    phone?: string;
    customerName?: string;
    addressLabel?: 'home' | 'office';
    addressInfo?: { line1?: string; city?: string; country?: string; zip?: string; notes?: string };
    deliveryOption?: { title: string; description?: string; price: number } | null;
  } | null;
  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;
  userEmail_lower?: string | null;
  promotionCode?: string | null;
  appliedPromotions?: Array<{ code?: string }>;
};

const toNum = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : undefined; };
const centsToUnit = (c?: number) => (Number.isFinite(c) ? Number(c) / 100 : 0);

function extractDelta(x: any): number {
  const a = toNum(x?.priceDelta); if (a !== undefined) return a;
  const b = toNum(x?.priceExtra); if (b !== undefined) return b;
  const ac = toNum(x?.priceDeltaCents); if (ac !== undefined) return ac / 100;
  const bc = toNum(x?.priceExtraCents); if (bc !== undefined) return bc / 100;
  const p = toNum(x?.price); if (p !== undefined) return p;
  const pc = toNum(x?.priceCents); if (pc !== undefined) return pc / 100;
  return 0;
}

function perUnitAddons(line: any): number {
  let sum = 0;
  if (Array.isArray(line?.optionGroups)) {
    for (const g of line.optionGroups) {
      const its = Array.isArray(g?.items) ? g.items : [];
      for (const it of its) sum += extractDelta(it);
    }
  }
  if (Array.isArray(line?.options)) {
    for (const g of line.options) {
      const sels = Array.isArray(g?.selected) ? g.selected : [];
      for (const s of sels) sum += extractDelta(s);
    }
  }
  for (const key of ['addons', 'extras', 'modifiers'] as const) {
    const arr = (line as any)[key];
    if (Array.isArray(arr)) for (const x of arr) sum += extractDelta(x);
  }
  return sum;
}

function baseUnitPrice(line: any): number {
  const baseCents = toNum(line?.basePriceCents); if (baseCents !== undefined) return baseCents / 100;
  const base = toNum(line?.basePrice); if (base !== undefined) return base;
  const miCents = toNum(line?.unitPriceCents) ?? toNum(line?.priceCents); if (miCents !== undefined) return miCents / 100;
  const mi = toNum(line?.unitPrice) ?? toNum(line?.price); if (mi !== undefined) return mi;

  const qty = Number(line?.quantity || 1);
  const totC = toNum(line?.totalCents);
  if (totC !== undefined && qty > 0) {
    const per = totC / 100 / qty;
    const addons = perUnitAddons(line);
    const derived = per - addons;
    if (derived > 0) return derived;
  }
  return 0;
}

function preferredLines(o: OrderDoc): OrderItemLine[] {
  return (Array.isArray(o.items) && o.items.length ? o.items! : (Array.isArray(o.lines) ? o.lines! : [])) as OrderItemLine[];
}

function computeTotals(o: OrderDoc) {
  if (o?.totals && (o.totals.subtotal !== undefined || (o.totals as any).deliveryFee !== undefined || (o.totals as any).tip !== undefined)) {
    const subtotal = Number(o.totals.subtotal || 0);
    const deliveryFee = Number((o.totals as any).deliveryFee || 0);
    const tip = Number((o.totals as any).tip || 0);
    const discount = Number((o.totals as any).discount || 0);
    const total = Number.isFinite(o.orderTotal) ? Number(o.orderTotal) : (subtotal + deliveryFee + tip - discount);
    const currency = (o.totals as any).currency || 'Q';
    return { subtotal, deliveryFee, tip, discount, total, currency };
  }
  if (o?.amounts && Number.isFinite(o.amounts.total)) {
    return {
      subtotal: Number(o.amounts.subtotal || 0),
      deliveryFee: 0,
      tip: Number(o.amounts.tip || 0),
      discount: Number(o.amounts.discount || 0),
      total: Number(o.amounts.total || 0),
      currency: 'Q',
    };
  }
  if (o?.totals && Number.isFinite(o.totals.totalCents)) {
    return {
      subtotal: centsToUnit(o.totals.subtotalCents),
      deliveryFee: centsToUnit((o.totals as any).deliveryFeeCents),
      tip: centsToUnit((o.totals as any).tipCents),
      discount: centsToUnit(o.totals.discountCents),
      total: centsToUnit(o.totals.totalCents),
      currency: 'Q',
    };
  }
  const lines = preferredLines(o);
  const subtotal = lines.reduce((acc, l) => {
    const qty = Number(l.quantity || 1);
    return acc + (baseUnitPrice(l) + perUnitAddons(l)) * qty;
  }, 0);
  const tip = Number(o.amounts?.tip || 0);
  return { subtotal, deliveryFee: 0, tip, discount: 0, total: subtotal + tip, currency: 'Q' };
}

function fmtCurrency(n: number, currency = 'Q') {
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}

function fullAddress(o: OrderDoc): string | null {
  const ai = o?.orderInfo?.addressInfo;
  if (ai && (ai.line1 || ai.city || ai.country || ai.zip)) {
    const parts: string[] = [];
    if (ai.line1) parts.push(String(ai.line1));
    if (ai.city) parts.push(String(ai.city));
    if (ai.country) parts.push(String(ai.country));
    let full = parts.join(', ');
    if (ai.zip) full = `${full} ${ai.zip}`;
    return full || null;
  }
  return o?.orderInfo?.address || null;
}

function promoLabel(o: OrderDoc): string | null {
  const promos = (o as any)?.appliedPromotions;
  if (Array.isArray(promos) && promos.length) {
    const names = promos.map((p: any) => p?.code || p?.name).filter(Boolean);
    if (names.length) return names.join(', ');
  }
  return (o as any)?.promotionCode || null;
}

export function orderDeliveredHtml(o: OrderDoc) {
  const orderNo = o.orderNumber || o.id;
  const name = (o.orderInfo?.customerName || "").trim();
  const greet = `Hi${name ? `, ${name}` : ""}!`;
  const addr = fullAddress(o);
  const phone = o.orderInfo?.phone || null;
  const totals = computeTotals(o);
  const currency = totals.currency || 'Q';

  const lines = preferredLines(o);
  const promo = promoLabel(o);
  const deliveryFeeShown = Number(o.orderInfo?.deliveryOption?.price || totals.deliveryFee || 0);

  const linesRows = lines.map((l, idx) => {
    const qty = Number(l.quantity || 1);
    const name = String(l.menuItemName || 'Item');
    const base = baseUnitPrice(l);
    const addons = perUnitAddons(l);
    const lineTotal = (base + addons) * qty;

    // Opciones/Extras en texto
    const extras: string[] = [];
    if (Array.isArray(l.optionGroups)) {
      for (const g of l.optionGroups) {
        const its = Array.isArray(g?.items) ? g.items : [];
        if (!its.length) continue;
        const part = `${g?.groupName || 'Options'}: ` + its.map((it) => {
          const nm = it?.name || '';
          const pr = extractDelta(it);
          return pr ? `${nm} (${fmtCurrency(pr, currency)})` : nm;
        }).join(', ');
        extras.push(part);
      }
    }
    if (Array.isArray(l.options)) {
      for (const g of l.options) {
        const its = Array.isArray(g?.selected) ? g.selected : [];
        if (!its.length) continue;
        const part = `${g?.groupName || 'Options'}: ` + its.map((it) => {
          const nm = it?.name || '';
          const pr = extractDelta(it);
          return pr ? `${nm} (${fmtCurrency(pr, currency)})` : nm;
        }).join(', ');
        extras.push(part);
      }
    }
    for (const key of ['addons', 'extras', 'modifiers'] as const) {
      const arr = (l as any)[key];
      if (Array.isArray(arr) && arr.length) {
        const part = `${key}: ` + arr.map((x: any) => {
          const nm = x?.name || String(x);
          const pr = extractDelta(x);
          return pr ? `${nm} (${fmtCurrency(pr, currency)})` : nm;
        }).join(', ');
        extras.push(part);
      }
    }

    return `
      <tr>
        <td style="padding:8px 0;vertical-align:top;"><strong>${qty} × ${name}</strong><br/>
          ${extras.map(e => `<div style="color:#6b7280;font-size:12px;">• ${e}</div>`).join('')}
        </td>
        <td style="padding:8px 0;text-align:right;white-space:nowrap;">${fmtCurrency(lineTotal, currency)}</td>
      </tr>
    `;
  }).join('');

  const promoRow = Number(totals.discount || 0) > 0 ? `
    <tr>
      <td style="padding:6px 0;color:#16a34a;">Discount${promo ? ` (${promo})` : ''}</td>
      <td style="padding:6px 0;text-align:right;color:#16a34a;">- ${fmtCurrency(Number(totals.discount), currency)}</td>
    </tr>` : '';

  const deliveryRow = `
    <tr>
      <td style="padding:6px 0;">Delivery${o.orderInfo?.deliveryOption?.title ? ` — ${o.orderInfo.deliveryOption.title}` : ''}</td>
      <td style="padding:6px 0;text-align:right;">${fmtCurrency(deliveryFeeShown, currency)}</td>
    </tr>`;

  return `
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#fff;opacity:0;">
    Your order ${orderNo} has been delivered.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fb;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(17,24,39,.06);">
        <tr>
          <td style="background:#111827;color:#ffffff;padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;">
            OrderCraft
          </td>
        </tr>
        <tr>
          <td style="padding:28px 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;">
            <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.3;color:#111827;">${greet}</h1>
            <p style="margin:0 0 10px 0;font-size:15px;color:#374151;">
              Your delivery order <strong>#${orderNo}</strong> has been <strong>delivered</strong>. Enjoy your meal! 🍽️
            </p>
            ${addr ? `<p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">Delivered to: ${addr}</p>` : ''}
            ${phone ? `<p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">Contact phone: ${phone}</p>` : ''}
          </td>
        </tr>

        <!-- Ticket -->
        <tr>
          <td style="padding:8px 24px 8px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
              <tr>
                <th align="left" style="padding:10px 0;font-size:13px;color:#374151;">Item</th>
                <th align="right" style="padding:10px 0;font-size:13px;color:#374151;">Total</th>
              </tr>
              ${linesRows || `<tr><td style="padding:8px 0;color:#6b7280;">No items</td><td></td></tr>`}
            </table>
          </td>
        </tr>

        <!-- Totals -->
        <tr>
          <td style="padding:8px 24px 8px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:6px 0;">Subtotal</td><td style="padding:6px 0;text-align:right;">${fmtCurrency(Number(totals.subtotal||0), currency)}</td></tr>
              ${deliveryRow}
              ${promoRow}
              ${Number(totals.tip||0) > 0 ? `<tr><td style="padding:6px 0;">Tip</td><td style="padding:6px 0;text-align:right;">${fmtCurrency(Number(totals.tip), currency)}</td></tr>` : ''}
              <tr><td style="padding:8px 0;font-weight:700;border-top:1px solid #e5e7eb;">Grand total</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e5e7eb;">${fmtCurrency(Number(totals.total||0), currency)}</td></tr>
            </table>
          </td>
        </tr>

        <!-- CTA -->
        <tr>
          <td style="padding:6px 24px 18px 24px;">
            <table role="presentation" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="border-radius:10px;background:#16a34a;">
                  <a href="${SITE_URL}" target="_blank" rel="noopener noreferrer"
                    style="display:inline-block;padding:12px 18px;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;">
                    Order again
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:10px 0 0 0;font-size:12px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">
              Need help? Just reply to this email.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:12px 24px 20px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#9ca3af;">
            © ${new Date().getFullYear()} OrderCraft
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
  `;
}

export function orderDeliveredText(o: OrderDoc) {
  const orderNo = o.orderNumber || o.id;
  const name = (o.orderInfo?.customerName || "").trim();
  const greet = `Hi${name ? `, ${name}` : ""}!`;
  const addr = fullAddress(o);
  const phone = o.orderInfo?.phone || null;
  const totals = computeTotals(o);
  const currency = totals.currency || 'Q';

  const lines = preferredLines(o).map((l) => {
    const qty = Number(l.quantity || 1);
    const nm = String(l.menuItemName || 'Item');
    const base = baseUnitPrice(l);
    const addons = perUnitAddons(l);
    const lineTotal = (base + addons) * qty;
    return `• ${qty} × ${nm} — ${fmtCurrency(lineTotal, currency)}`;
  }).join('\n');

  const promo = promoLabel(o);
  const parts: string[] = [];
  parts.push(`${greet}`);
  parts.push(`Your delivery order #${orderNo} has been delivered.`);
  if (addr) parts.push(`Delivered to: ${addr}`);
  if (phone) parts.push(`Contact phone: ${phone}`);
  parts.push('');
  parts.push('Items:');
  parts.push(lines || '—');
  parts.push('');
  parts.push(`Subtotal: ${fmtCurrency(Number(totals.subtotal||0), currency)}`);
  if (Number(totals.deliveryFee||0) > 0) parts.push(`Delivery: ${fmtCurrency(Number(totals.deliveryFee||0), currency)}`);
  if (Number(totals.discount||0) > 0) parts.push(`Discount${promo ? ` (${promo})` : ''}: -${fmtCurrency(Number(totals.discount||0), currency)}`);
  if (Number(totals.tip||0) > 0) parts.push(`Tip: ${fmtCurrency(Number(totals.tip||0), currency)}`);
  parts.push(`Grand total: ${fmtCurrency(Number(totals.total||0), currency)}`);
  parts.push('');
  parts.push(`Order again: ${SITE_URL}`);
  return parts.join('\n');
}
