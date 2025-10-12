'use client';

import '@/lib/firebase/client';
import { useEffect, useMemo, useState } from 'react';
import { getFirestore, query, orderBy, onSnapshot /*, where */ } from 'firebase/firestore';
import Image from 'next/image';
import Link from 'next/link';

// PhaseC/D
import { useTenantId } from '@/lib/tenant/context';
import { tCol } from '@/lib/db';

type Category = {
  id: string;
  name: string;
  slug?: string;
  sortOrder?: number;
  isActive?: boolean;
  imageUrl?: string | null;
};

export default function MenuHomePage() {
  const db = useMemo(() => getFirestore(), []);
  const tenantId = useTenantId(); // ✅ tenant desde contexto (PhaseC)
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    if (!tenantId) return; // aún no resuelto el tenant (SSR/CSR bridge)

    // ✅ namespaced: tenants/{tenantId}/categories
    // Opcional: añadir where('isActive','==', true)
    const q = query(
      tCol<Category>('categories', tenantId),
      // where('isActive','==', true),
      orderBy('sortOrder', 'asc')
    );

    const unsub = onSnapshot(q, (snap) => {
      setCategories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [db, tenantId]);

  // Pequeño guard visual mientras resolvemos tenantId
  if (!tenantId) {
    return (
      <div className="container py-4">
        <div className="alert alert-light border">Loading…</div>
      </div>
    );
  }

  return (
    <div className="container py-4">
      <h1 className="h3 mb-3">Featured</h1>
      <div className="row g-4">
        {categories.map((cat) => {
          // ✅ link absoluto por tenant para evitar perder el prefijo
          const href = `/${tenantId}/app/menu/${cat.id}`;

          return (
            <div className="col-12 col-md-6 col-xl-3" key={cat.id}>
              <Link href={href} className="text-decoration-none">
                <div className="card border-0 shadow-sm h-100 position-relative">
                  <div className="ratio ratio-16x9 rounded-top overflow-hidden">
                    {cat.imageUrl ? (
                      <Image
                        src={cat.imageUrl}
                        alt={cat.name}
                        fill
                        sizes="(max-width: 576px) 100vw, (max-width: 1200px) 50vw, 25vw"
                        className="object-fit-cover"
                        priority
                      />
                    ) : (
                      <div className="d-flex align-items-center justify-content-center bg-light text-muted">
                        No image
                      </div>
                    )}
                  </div>
                  <div className="card-img-overlay d-flex align-items-end p-0">
                    <div className="w-100 bg-white px-3 py-3 border-top">
                      <div className="fw-semibold text-dark">{cat.name}</div>
                    </div>
                  </div>
                </div>
              </Link>
            </div>
          );
        })}

        {categories.length === 0 && (
          <div className="col-12">
            <div className="alert alert-light border">There are no categories yet.</div>
          </div>
        )}
      </div>
    </div>
  );
}
