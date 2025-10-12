export const dynamic = 'force-dynamic';
import { adminDb } from '@/lib/firebase/admin';

type OrderDoc = {
  tenantId: string;
  status: string;
  orderTotal?: number;             // si lo tienes como number
  totalsCents?: { total?: number } // si lo guardas en centavos
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
};

async function getSalesSince(days = 30) {
  const since = new Date(Date.now() - days*24*60*60*1000);
  const snap = await adminDb.collectionGroup('orders')
    .where('createdAt', '>=', since)
    .get();

  // Agrega por tenant
  const perTenant = new Map<string, { count: number; total: number }>();
  snap.docs.forEach(d => {
    const data = d.data() as OrderDoc;
    if (!['closed','delivered'].includes(data.status)) return;
    const key = data.tenantId || 'unknown';
    const amount = (data.orderTotal ?? (data.totalsCents?.total ? data.totalsCents.total/100 : 0)) || 0;

    const prev = perTenant.get(key) || { count: 0, total: 0 };
    prev.count += 1;
    prev.total += amount;
    perTenant.set(key, prev);
  });

  // A plano
  return Array.from(perTenant.entries())
    .map(([tenantId, agg]) => ({ tenantId, ...agg }))
    .sort((a,b) => b.total - a.total);
}

export default async function SalesReportPage() {
  const rows = await getSalesSince(30);

  return (
    <main className="container py-4">
      <h1 className="h4 fw-semibold mb-3">Reporte • Ventas últimos 30 días</h1>
      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Tenant</th>
              <th># Órdenes</th>
              <th>Total (USD)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.tenantId}>
                <td><code>{r.tenantId}</code></td>
                <td>{r.count}</td>
                <td>${r.total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted small mt-3">* Ajusta monedas si usas múltiples (<code>currency</code> por orden).</p>
    </main>
  );
}
