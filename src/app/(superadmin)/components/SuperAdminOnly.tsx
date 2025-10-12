"use client";
import React from "react";
import { useAuth } from "@/app/providers";
import { Spinner } from "./ui/Spinner"; // opcional

export default function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { loading, user, claims } = useAuth(); // claims.superadmin === true

  if (loading) return <div className="text-center py-5"><Spinner /></div>;
  if (!user || !claims?.superadmin) {
    return (
      <div className="container py-5">
        <div className="alert alert-danger">
          No tienes permiso para acceder a esta sección.
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
