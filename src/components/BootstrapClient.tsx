// src/components/BootstrapClient.tsx
'use client';
import { useEffect } from 'react';

export default function BootstrapClient() {
  useEffect(() => {
    // Incluye Popper y funciona con Turbopack
    import('bootstrap/dist/js/bootstrap.bundle').catch(() => {});
  }, []);
  return null;
}
