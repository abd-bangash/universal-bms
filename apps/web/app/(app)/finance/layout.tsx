import type { ReactNode } from 'react';
import { FinanceNav } from './finance-nav';

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-6xl">
      <FinanceNav />
      {children}
    </div>
  );
}
