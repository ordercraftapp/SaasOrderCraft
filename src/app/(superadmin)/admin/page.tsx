export const dynamic = 'force-dynamic';
import Link from "next/link";

export default function SuperadminPortal() {
  return (
    <main className="container py-4">
      <header className="mb-4">
        <h1 className="h3 fw-bold">Superadmin • Portal</h1>
        <p className="text-muted">Herramientas y reportes globales (cross-tenant).</p>
      </header>

      <div className="row g-3">
        <div className="col-12 col-md-6 col-lg-4">
          <Link className="text-decoration-none" href="/superadmin/reports/subdomains">
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <div className="d-flex align-items-center gap-3">
                  <span style={{fontSize:24}}>🌐</span>
                  <div>
                    <div className="h5 m-0">Subdominios</div>
                    <small className="text-muted">Listado de tenants y dominios.</small>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        </div>

        <div className="col-12 col-md-6 col-lg-4">
          <Link className="text-decoration-none" href="/superadmin/reports/accounts">
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <div className="d-flex align-items-center gap-3">
                  <span style={{fontSize:24}}>👤</span>
                  <div>
                    <div className="h5 m-0">Cuentas y cobros</div>
                    <small className="text-muted">Plan, fecha de creación y próximo cargo.</small>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        </div>

        <div className="col-12 col-md-6 col-lg-4">
          <Link className="text-decoration-none" href="/superadmin/reports/sales">
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <div className="d-flex align-items-center gap-3">
                  <span style={{fontSize:24}}>📊</span>
                  <div>
                    <div className="h5 m-0">Reporte de ventas</div>
                    <small className="text-muted">Ventas por tenant (collectionGroup).</small>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        </div>

        <div className="col-12 col-md-6 col-lg-4">
          <Link className="text-decoration-none" href="/superadmin/accounts">
            <div className="card shadow-sm h-100">
              <div className="card-body">
                <div className="d-flex align-items-center gap-3">
                  <span style={{fontSize:24}}>🛠️</span>
                  <div>
                    <div className="h5 m-0">Gestión de cuentas</div>
                    <small className="text-muted">Suspender / reactivar / cancelar tenants.</small>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        </div>
      </div>
    </main>
  );
}
