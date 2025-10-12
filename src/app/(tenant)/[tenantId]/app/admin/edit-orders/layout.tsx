'use client';

import React from 'react';
import { EditCartProvider } from "@/lib/edit-cart/context";
import ToolGate from '@/components/ToolGate';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <EditCartProvider>
      <ToolGate feature="editOrders">
        {children}
      </ToolGate>
    </EditCartProvider>
  );
}
