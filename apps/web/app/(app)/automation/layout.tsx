import type { ReactNode } from 'react';
import { AutomationNav } from '@/components/layout/automation-nav';

export default function AutomationLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-5xl">
      <AutomationNav />
      {children}
    </div>
  );
}
