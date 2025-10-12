export const dynamic = 'force-dynamic';
import { adminDb } from '@/lib/firebase/admin';

type TenantDoc = {
  tenantId: string;
  plan: 'starter'|'pro'|'full';
  status: 'draft'|'active'|'suspended';
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
};

function addMonths(date: Date, months: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function nextMonthlyChargeFromCreated(createdAt?: FirebaseFirestore.Timestamp) {
  if (!createdAt) return null;
  // Si quieres trial de 14 días, suma primero 14d, luego ancla mensual.
  const created = createdAt.toDate();
  const now = new Date();
  // Encuentra el próximo mes "aniversario"
  let next = addMonths(created, Math.max(1, (now.getFullYear()-created.getFullYear())*12 + (now.getMonth()-created.getMonth()) + (now.getDate()>created.getDate()?1:0)));
  // Asegura que always futuro:
  if (next <= now) next = addMonths(next, 1);
  return next;
}

async function getAccounts(limit = 500): Promise<TenantDoc[]> {
  const snap = await adminDb.collection('tenants').orderBy('createdAt','desc').limit(limit).get();
  return snap.docs.map(d => d.data() as TenantDoc);
}

export default async function AccountsReportPage() {
  const rows = await getAccounts();

  return (
    <main className="container py-4">
      <h1 className="h4 fw-semibold mb-3">Reporte • Cuentas y cobros</h1>
      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Creado</th>
              <th>Próximo cargo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const next = nextMonthlyChargeFromCreated(r.createdAt);
              return (
                <tr key={r.tenantId}>
                  <td><code>{r.tenantId}</code></td>
                  <td>{r.plan}</td>
                  <td><span className={`badge bg-${r.status==='active'?'success':r.status==='draft'?'secondary':'warning'}`}>{r.status}</span></td>
                  <td>{r.createdAt ? new Date(r.createdAt.toMillis()).toLocaleString() : '—'}</td>
                  <td>{next ? next.toLocaleDateString() : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-muted small mt-3">
        * Para ciclos reales, guarda <code>billingAnchorAt</code> y <code>nextChargeAt</code> en el tenant durante la provisión.
      </p>
    </main>
  );
}
