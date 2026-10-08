'use client';

import { useCallback } from 'react';
import { DEFAULT_TERMINOLOGY, type TermKey, type Terminology } from '@bms/types';
import { useSession } from './session';

export type TermForm = 'singular' | 'plural';

/** Resolves a term in the workspace's own words, falling back to the neutral default. */
export function resolveTerm(
  terminology: Partial<Terminology>,
  key: TermKey,
  form: TermForm = 'singular',
): string {
  return (terminology[key] ?? DEFAULT_TERMINOLOGY[key])[form];
}

/**
 * `const t = useTerminology(); t('customer')` gives "Guest" in a hotel and "Customer" in a shop
 * (Requirement 28.2). Use `t('customer', 'plural')` for the plural.
 */
export function useTerminology(): (key: TermKey, form?: TermForm) => string {
  const { terminology } = useSession();
  return useCallback(
    (key, form = 'singular') => resolveTerm(terminology, key, form),
    [terminology],
  );
}
