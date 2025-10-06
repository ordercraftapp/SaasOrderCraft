// src/types/client.ts
export type TimestampISO = string;

export interface Address {
  id: string;
  label?: string | null;
  street: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  notes?: string | null;
  isDefault?: boolean;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}

export interface ClientProfile {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  photoURL?: string | null;
  addresses?: Address[];
  tenantId?: string | null;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}
