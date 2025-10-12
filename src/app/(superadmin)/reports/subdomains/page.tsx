export const dynamic = 'force-dynamic';
import { adminDb } from '@/lib/firebase/admin';

type TenantRow = {
  tenantId: string;
  plan: 'starter'|'pro'|'full';
  status: 'draft'|'active'|'suspended';
  customDomain?: string|null;
  createdAt?: FirebaseFirestore.Timestamp;
  updatedAt?: FirebaseFirestore.Timestamp;
};

async function getTenants(limit = 500): Promise<TenantRow[]> {
  const snap = await adminDb.collection('tenants').orderBy('tenantId').limit(limit).get();
  return snap.docs.map(d => d.data() as TenantRow);
}

export default async function SubdomainsReportPage() {
  const rows = await getTenants();

  return (
    <main className="container py-4">
      <h1 className="h4 fw-semibold mb-3">Reporte • Subdominios</h1>
      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Dominio</th>
              <th>Creado</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.tenantId}>
                <td><code>{r.tenantId}</code></td>
                <td>{r.plan}</td>
                <td>
                  <span className={`badge bg-${r.status==='active'?'success':r.status==='draft'?'secondary':'warning'}`}>
                    {r.status}
                  </span>
                </td>
                <td>{r.customDomain || `${r.tenantId}.datacraftcoders.cloud`}</td>
                <td>{r.createdAt ? new Date(r.createdAt.toMillis()).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
