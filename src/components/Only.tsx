// src/components/Only.tsx
"use client";
import { RoleGate } from "./RoleGate";

export const OnlyAdmin = ({ children }: { children: React.ReactNode }) => (
  <RoleGate allow={["admin"]}>{children}</RoleGate>
);

export const OnlyKitchen = ({ children }: { children: React.ReactNode }) => (
  <RoleGate allow={["kitchen", "admin"]}>{children}</RoleGate>
);

export const OnlyWaiter = ({ children }: { children: React.ReactNode }) => (
  <RoleGate allow={["waiter", "admin"]}>{children}</RoleGate>
);

export const OnlyDelivery = ({ children }: { children: React.ReactNode }) => (
  <RoleGate allow={["delivery", "admin"]}>{children}</RoleGate>
);

export const OnlyCashier = ({ children }: { children: React.ReactNode }) => (
  <RoleGate allow={["cashier", "admin"]}>{children}</RoleGate>
);

export const OnlyCustomer = ({ children }: { children: React.ReactNode }) => (
  <RoleGate allow={["customer"]}>{children}</RoleGate>
);
