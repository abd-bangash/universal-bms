'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './button';

/**
 * A modal confirmation on the browser's native <dialog>, which traps focus and closes on Escape.
 * `pending` disables the buttons while the confirmed action runs.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className="w-full max-w-md rounded-lg border border-neutral-200 p-6 shadow-lg backdrop:bg-black/40"
    >
      <h2 id="confirm-title" className="text-lg font-semibold">
        {title ?? t('confirm.title')}
      </h2>
      {description ? <div className="mt-2 text-sm text-neutral-700">{description}</div> : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          {t('common.cancel')}
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={destructive ? 'bg-red-700 hover:bg-red-800' : undefined}
        >
          {confirmLabel ?? t('common.confirm')}
        </Button>
      </div>
    </dialog>
  );
}
