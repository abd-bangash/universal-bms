'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError } from './errors';

/** A user-facing sentence for any thrown error, from the translation layer (never a stack trace). */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations('errors');
  return useCallback(
    (error: unknown) => {
      if (error instanceof ApiError) {
        return t.has(error.code) ? t(error.code) : t('unknown');
      }
      return t('unknown');
    },
    [t],
  );
}
