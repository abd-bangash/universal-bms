'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { api, browser } from '@/lib/api-client';
import { GlobalSearch } from './global-search';
import { NAVIGATION, visibleNavigation, type NavigationEntry } from '@/lib/navigation';
import { SessionProvider, useMeQuery, useSession } from '@/lib/session';
import { useTerminology } from '@/lib/terminology';
import { cn } from '@/lib/utils';

/** The signed-in frame: loads the session, then shows the sidebar, header and page. */
export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const me = useMeQuery();

  if (me.isPending) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        role="status"
        aria-live="polite"
      >
        {t('common.loading')}
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 p-6">
        <Alert>{t('shell.loadFailed')}</Alert>
        <Button type="button" onClick={() => void me.refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  return (
    <SessionProvider value={me.data}>
      <Frame>{children}</Frame>
    </SessionProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const { workspace } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {t('shell.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 flex min-h-14 flex-wrap items-center gap-3 py-2 border-b border-neutral-200 bg-white px-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="md:hidden"
          aria-expanded={menuOpen}
          aria-controls="main-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? t('nav.close') : t('nav.open')}
        </Button>
        <span className="truncate font-semibold" title={t('shell.workspace')}>
          {workspace.name}
        </span>
        <div className="order-last w-full sm:order-none sm:mx-auto sm:max-w-md">
          <GlobalSearch />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled
          aria-label={t('shell.notifications')}
          title={t('shell.notifications')}
          className="ml-auto sm:ml-0"
        >
          <span aria-hidden="true">🔔</span>
        </Button>
        <UserMenu />
      </header>
      <div className="flex">
        <Sidebar open={menuOpen} onNavigate={() => setMenuOpen(false)} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const t = useTranslations('nav');
  const term = useTerminology();
  const { permissions, modules } = useSession();
  const pathname = usePathname();
  const entries = visibleNavigation(NAVIGATION, { permissions, modules });

  const labelOf = (entry: NavigationEntry) =>
    'term' in entry.label ? term(entry.label.term, 'plural') : t(entry.label.message);
  const isActive = (entry: NavigationEntry) =>
    entry.href === '/' ? pathname === '/' : pathname.startsWith(entry.href);

  return (
    <nav
      id="main-navigation"
      aria-label={t('label')}
      className={cn(
        'w-56 shrink-0 border-r border-neutral-200 bg-white p-3',
        'max-md:fixed max-md:inset-y-14 max-md:left-0 max-md:z-20 max-md:shadow-lg',
        open ? 'max-md:block' : 'max-md:hidden',
      )}
    >
      <ul className="flex flex-col gap-1">
        {entries.map((entry) => (
          <li key={entry.key}>
            <Link
              href={entry.href}
              onClick={onNavigate}
              aria-current={isActive(entry) ? 'page' : undefined}
              className={cn(
                'block rounded-md px-3 py-2 text-sm hover:bg-neutral-100',
                isActive(entry) && 'bg-neutral-900 text-white hover:bg-neutral-900',
              )}
            >
              {labelOf(entry)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function UserMenu() {
  const t = useTranslations();
  const { user, roles } = useSession();
  const [busy, setBusy] = useState(false);
  const name = `${user.firstName} ${user.lastName}`.trim();

  async function signOut() {
    setBusy(true);
    try {
      await api.post('/auth/logout');
    } finally {
      browser.assign('/login');
    }
  }

  return (
    <details className="relative">
      <summary
        className="cursor-pointer list-none rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        aria-label={t('shell.userMenu')}
      >
        {name}
      </summary>
      <div className="absolute right-0 mt-1 w-64 rounded-md border border-neutral-200 bg-white p-3 text-sm shadow-lg">
        <p className="font-medium">{t('shell.signedInAs', { name })}</p>
        <p className="truncate text-neutral-600">{user.email}</p>
        <p className="mb-3 text-neutral-600">{roles.join(', ')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void signOut()}
        >
          {t('common.signOut')}
        </Button>
      </div>
    </details>
  );
}
