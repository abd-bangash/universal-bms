'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useErrorMessage } from '@/lib/error-message';
import { ApiError } from '@/lib/errors';

/** Warns before the tab is closed or reloaded while a form holds unsaved changes (Requirement 49.5). */
export function useUnsavedChangesWarning(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return undefined;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}

/** Puts the API's field-level messages on the matching fields; returns the ones with no field. */
export function applyServerErrors<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: ApiError,
): boolean {
  let placed = false;
  for (const [path, messages] of Object.entries(error.details ?? {})) {
    const message = messages[0];
    if (!message) continue;
    form.setError(path as Path<T>, { type: 'server', message });
    placed = true;
  }
  return placed;
}

/**
 * The common wrapper for forms: inline validation (react-hook-form), server validation errors
 * shown against their fields, a general error banner, a submit button that is disabled while the
 * request is pending, and a warning before unsaved changes are discarded.
 */
export function FormShell<T extends FieldValues>({
  form,
  onSubmit,
  submitLabel,
  children,
  actions,
  className,
  successMessage,
}: {
  form: UseFormReturn<T>;
  onSubmit: (values: T) => Promise<void>;
  submitLabel?: string;
  children: ReactNode;
  /** Extra buttons next to the submit button (for example Cancel). */
  actions?: ReactNode;
  className?: string;
  successMessage?: string;
}) {
  const t = useTranslations();
  const message = useErrorMessage();
  const [banner, setBanner] = useState<string | null>(null);
  const { isDirty, isSubmitting, isSubmitSuccessful } = form.formState;

  useUnsavedChangesWarning(isDirty && !isSubmitSuccessful);

  const submit = form.handleSubmit(async (values) => {
    setBanner(null);
    try {
      await onSubmit(values);
    } catch (error) {
      if (error instanceof ApiError) {
        const placed = applyServerErrors(form, error);
        setBanner(placed ? t('errors.VALIDATION_FAILED') : message(error));
      } else {
        setBanner(message(error));
      }
    }
  });

  return (
    <form
      noValidate
      className={className ?? 'flex flex-col gap-4'}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        void submit(event);
      }}
      aria-busy={isSubmitting}
    >
      {banner ? <Alert>{banner}</Alert> : null}
      {isSubmitSuccessful && !banner && successMessage ? (
        <Alert tone="success">{successMessage}</Alert>
      ) : null}
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('form.saving') : (submitLabel ?? t('form.submit'))}
        </Button>
        {actions}
      </div>
    </form>
  );
}
