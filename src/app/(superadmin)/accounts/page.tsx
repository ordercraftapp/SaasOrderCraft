export const dynamic = 'force-dynamic';
import { adminDb } from '@/lib/firebase/admin';
import SuspendButtons from './suspend-buttons';

type TenantDoc = {
  tenantId: string;
  plan: 'starter'|'pro'|'full';
  status: 'draft'|'active'|'suspended';
  owner?: { name?: string; email?: string; uid?: string };
  createdAt?: FirebaseFirestore.Timestamp;
  cancelledAt?: FirebaseFirestore.Timestamp|null;
  statusReason?: string|null;
};

async function getTenants(limit=200) {
  const snap = await adminDb.collection('tenants').orderBy('createdAt','desc').limit(limit).get();
  return snap.docs.map(d => d.data() as TenantDoc);
}

export default async function AccountsManagePage() {
  const tenants = await getTenants();

  return (
    <main className="container py-4">
      <h1 className="h4 fw-semibold mb-3">Gestión de cuentas</h1>
      <div className="table-responsive">
        <table className="table table-sm align-middle">
          <thead>
            <tr>
              <th>Tenant</th>
              <th>Plan</th>
              <th>Estado</th>
              <th>Owner</th>
              <th>Creado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map(t => (
              <tr key={t.tenantId}>
                <td><code>{t.tenantId}</code></td>
                <td>{t.plan}</td>
                <td>
                  <span className={`badge bg-${t.status==='active'?'success':t.status==='draft'?'secondary':'warning'}`}>
                    {t.status}
                  </span>
                </td>
                <td>{t.owner?.email || '—'}</td>
                <td>{t.createdAt ? new Date(t.createdAt.toMillis()).toLocaleString() : '—'}</td>
                <td><SuspendButtons tenantId={t.tenantId} status={t.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
