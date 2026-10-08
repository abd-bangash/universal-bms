import type { ReactNode } from 'react';
import { InventoryNav } from './inventory-nav';

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-6xl">
      <InventoryNav />
      {children}
    </div>
  );
}
