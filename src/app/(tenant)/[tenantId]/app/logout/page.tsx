// src/app/(tenant)/[tenantId]/app/logout/page.tsx
'use client';

import { useEffect } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { useRouter } from 'next/navigation';
import AuthNavbar from '@/app/(tenant)/[tenantId]/components/AuthNavbar';
import { useTenantId } from '@/lib/tenant/context';

// Borra cookie en la ruta indicada
function delCookie(name: string, path: string = '/') {
  document.cookie = `${name}=; Path=${path}; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

export default function LogoutPage() {
  const router = useRouter();
  const tenantId = useTenantId();

  useEffect(() => {
    (async () => {
      try {
        await signOut(auth);
      } catch {
        // no-op
      }

      // Borra cookies que tu middleware revisa (en raíz y en el path del tenant)
      const names = ['session', 'idToken', 'auth', 'appRole', 'role', 'roles'];
      for (const n of names) delCookie(n, '/');                // raíz
      if (tenantId) {
        for (const n of names) delCookie(n, `/${tenantId}`);   // scope del tenant
      }
      // Si quieres limpiar tenantId también:
      // delCookie('tenantId', '/');

      const dest = tenantId ? `/${tenantId}/app/login` : '/login';
      router.replace(dest);
    })();
  }, [router, tenantId]);

  return (
    <>
      <AuthNavbar />
      <main style={{ padding: 24 }}>Signing out…</main>
    </>
  );
}
