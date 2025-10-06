// src/lib/api/client.ts
"use client";

import { getAuth } from "firebase/auth";
import "@/lib/firebase/client"; // asegura init

export async function apiFetch(path: string, init?: RequestInit) {
  const auth = getAuth();
  const user = auth.currentUser;
  const headers: HeadersInit = { ...(init?.headers || {}), "Content-Type": "application/json" };

  if (user) {
    const token = await user.getIdToken(/* forceRefresh? */);
    (headers as any).Authorization = `Bearer ${token}`;
  }

  return fetch(path, { ...init, headers });
}
