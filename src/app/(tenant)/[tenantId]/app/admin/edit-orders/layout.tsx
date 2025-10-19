'use client';

import React from 'react';
import { EditCartProvider } from "@/lib/edit-cart/context";
import ToolGate from '@/components/ToolGate';
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import { OnlyAdmin } from "@/app/(tenant)/[tenantId]/components/Only";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <Protected>
      <OnlyAdmin>
        <EditCartProvider>
          <ToolGate feature="editOrders">
            {children}
          </ToolGate>
        </EditCartProvider>
      </OnlyAdmin>
    </Protected>
  );
}
