import type { ReactNode } from 'react';
import { SettingsNav } from '@/components/layout/settings-nav';

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-5xl">
      <SettingsNav />
      {children}
    </div>
  );
}
