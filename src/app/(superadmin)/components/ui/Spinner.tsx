"use client";

import React from "react";

type Props = {
  /** 'sm' | 'md' | 'lg' (clase utility) */
  size?: "sm" | "md" | "lg";
  /** Texto accesible (screen readers) */
  label?: string;
  /** Clases extra */
  className?: string;
};

export function Spinner({ size = "md", label = "Cargando…", className = "" }: Props) {
  const sizeClass =
    size === "sm" ? "spinner-border-sm" :
    size === "lg" ? "spinner-border-lg" : "";

  return (
    <div className={`d-inline-flex align-items-center gap-2 ${className}`}>
      <div className={`spinner-border ${sizeClass}`} role="status" aria-live="polite" aria-label={label}>
        <span className="visually-hidden">{label}</span>
      </div>
      {/* Texto opcional visible. Si no lo quieres, quítalo */}
      <span className="text-muted">{label}</span>
    </div>
  );
}

export default Spinner;
