'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { usePermission } from '@/lib/session';
import { ActivityPanel } from './activity-panel';

/** A small button that opens the activity of one record in a dialog (for lists that have no page per record). */
export function ActivityButton({
  entityType,
  entityId,
  name,
}: {
  entityType: string;
  entityId: string;
  name: string;
}) {
  const t = useTranslations('activity');
  const allowed = usePermission('audit:view');
  const [open, setOpen] = useState(false);
  if (!allowed) return null;
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={t('openFor', { name })}
        onClick={() => setOpen(true)}
      >
        {t('button')}
      </Button>
      {open ? (
        <Modal open title={t('openFor', { name })} onClose={() => setOpen(false)}>
          <ActivityPanel entityType={entityType} entityId={entityId} />
        </Modal>
      ) : null}
    </>
  );
}
