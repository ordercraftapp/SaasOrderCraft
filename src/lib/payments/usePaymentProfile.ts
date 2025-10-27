// src/lib/payments/use.ts

'use client';

import { useEffect, useState } from 'react';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { useTenantId } from '@/lib/tenant/context';
// Si ya tienes este helper que scopia por tenant: tCol('paymentProfile', tenantId)
// si no, ver opción sin tCol más abajo.
import { tCol } from '@/lib/db';

export function usePaymentProfile() {
  const tenantId = useTenantId();
  const [flags, setFlags] = useState<{ cash: boolean; paypal: boolean }>({ cash: true, paypal: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;

    const auth = getAuth();
    let cancelled = false;

    (async () => {
      try {
        const u = auth.currentUser;

        if (!u) {
          if (!cancelled) { setFlags({ cash: true, paypal: false }); setLoading(false); }
          return;
        }

        // 1) token fresco
        let idToken = await u.getIdToken(/*forceRefresh*/ true);

        // 2) refresca rol/claims por tenant (puede devolver claimsUpdated)
        const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
          cache: 'no-store',
          credentials: 'same-origin',
        }).catch(() => null);

        if (resp && resp.ok) {
          const data = await resp.json().catch(() => ({}));
          if (data?.claimsUpdated) {
            await u.getIdToken(true);
          }
        }

        // 3) lee paymentProfile ya con claims correctos
        const db = getFirestore();
        const ref = doc(tCol('paymentProfile', tenantId), 'default');
        const snap = await getDoc(ref);

        if (cancelled) return;

        if (snap.exists()) {
          const data: any = snap.data() || {};
          const src = (data && typeof data === 'object') ? (data.payments || data) : {};
          setFlags({ cash: !!src.cash, paypal: !!src.paypal });
        } else {
          setFlags({ cash: true, paypal: false });
        }
      } catch (e) {
        console.warn('paymentProfile read failed:', e);
        if (!cancelled) setFlags({ cash: true, paypal: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId]);

  return { flags, loading };
}
