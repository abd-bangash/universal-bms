import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('auth');
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-50 p-4">
      <p className="text-xl font-semibold">{process.env.NEXT_PUBLIC_APP_NAME ?? t('appName')}</p>
      <div className="w-full max-w-sm">{children}</div>
    </main>
  );
}
