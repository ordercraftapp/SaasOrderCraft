"use client";
import React, { useState } from "react";

export default function SuspendButtons({ tenantId, status }: { tenantId: string; status: 'draft'|'active'|'suspended' }) {
  const [busy, setBusy] = useState(false);
  const on = async (path: 'suspend'|'reactivate'|'cancel') => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/superadmin/api/accounts/${tenantId}/${path}`, { method: 'POST' });
      if (!res.ok) throw new Error(await res.text());
      window.location.reload();
    } catch (e) {
      alert('Error: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="btn-group">
      <button className="btn btn-outline-warning btn-sm" disabled={busy || status==='suspended'} onClick={() => on('suspend')}>Suspender</button>
      <button className="btn btn-outline-success btn-sm" disabled={busy || status==='active'} onClick={() => on('reactivate')}>Reactivar</button>
      <button className="btn btn-outline-danger btn-sm" disabled={busy} onClick={() => on('cancel')}>Cancelar</button>
    </div>
  );
}
