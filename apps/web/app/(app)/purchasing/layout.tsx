import type { ReactNode } from 'react';
import { PurchasingNav } from './purchasing-nav';

export default function PurchasingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-6xl">
      <PurchasingNav />
      {children}
    </div>
  );
}
