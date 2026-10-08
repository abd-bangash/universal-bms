'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface RoleView {
  id: string;
  name: string;
  isSystem: boolean;
  isOwner: boolean;
  permissions: string[];
  maxDiscountPercent: string;
  viewerModules: string[];
  memberCount: number;
}

export interface PermissionCatalogue {
  resources: Array<{ resource: string; actions: string[]; permissions: string[] }>;
  permissions: string[];
}

export const ROLES_QUERY_KEY = ['roles'] as const;

export function useRolesQuery(enabled = true) {
  return useQuery({
    queryKey: ROLES_QUERY_KEY,
    queryFn: ({ signal }) => api.get<RoleView[]>('/roles', undefined, signal),
    enabled,
  });
}

export function useCatalogueQuery(enabled = true) {
  return useQuery({
    queryKey: ['permission-catalogue'],
    queryFn: ({ signal }) => api.get<PermissionCatalogue>('/permissions', undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}
