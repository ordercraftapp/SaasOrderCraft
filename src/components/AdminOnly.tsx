// src/components/AdminOnly.tsx
"use client";
import { useAuth } from "@/app/providers";

export default function AdminOnly({ children }: { children: React.ReactNode }) {
  const { loading, flags } = useAuth();
  if (loading) return <p style={{ padding: 24 }}>Cargando…</p>;
  if (!flags.isAdmin) return <p style={{ padding: 24, color: "crimson" }}>Access denied.</p>;
  return <>{children}</>;
}
