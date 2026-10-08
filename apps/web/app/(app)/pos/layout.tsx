import type { ReactNode } from 'react';
import { PosNav } from './pos-nav';

export default function PosLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-6xl">
      <PosNav />
      {children}
    </div>
  );
}
