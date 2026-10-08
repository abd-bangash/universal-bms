'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ModuleKey, Terminology } from '@bms/types';
import { api } from './api-client';
import { DEFAULT_LOCALE, type LocaleSettings } from './format';

/** The signed-in user and workspace, from GET /auth/me. */
export interface Me {
  user: { id: string; email: string; firstName: string; lastName: string };
  workspace: { id: string; name: string; industryProfile: string; locale: Partial<LocaleSettings> };
  roles: string[];
  permissions: string[];
  terminology: Partial<Terminology>;
  modules: Partial<Record<ModuleKey, boolean>>;
}

export const ME_QUERY_KEY = ['me'] as const;

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ value, children }: { value: Me; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Loads the session; the app shell renders its children only once this has resolved. */
export function useMeQuery() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: ({ signal }) => api.get<Me>('/auth/me', undefined, signal),
    staleTime: 60_000,
    retry: false,
  });
}

export function useSession(): Me {
  const me = useContext(SessionContext);
  if (!me) throw new Error('useSession must be used inside the signed-in app shell');
  return me;
}

/** Whether the signed-in user holds a permission. Hides UI only: the API enforces every permission. */
export function usePermission(permission: string): boolean {
  return useSession().permissions.includes(permission);
}

export function useWorkspaceLocale(): LocaleSettings {
  const { workspace } = useSession();
  return useMemo(() => ({ ...DEFAULT_LOCALE, ...workspace.locale }), [workspace.locale]);
}

export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>;
}
