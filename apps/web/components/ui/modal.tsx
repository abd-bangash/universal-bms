'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './button';
import { cn } from '@/lib/utils';

/**
 * A content dialog on the native <dialog> element (focus is trapped, Escape closes it).
 * Unlike ConfirmDialog it holds any content, such as an editing form.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const t = useTranslations('modal');
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
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={cn(
        'max-h-[90vh] w-full overflow-y-auto rounded-lg border border-neutral-200 p-0 shadow-lg backdrop:bg-black/40',
        wide ? 'max-w-3xl' : 'max-w-lg',
      )}
    >
      {open ? (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{title}</h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              aria-label={t('close')}
            >
              ×
            </Button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
