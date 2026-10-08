'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { MoneyInput } from '@/components/forms/money-input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { useStaffCommission } from '@/lib/hooks/use-commissions';
import { usePermission } from '@/lib/session';

/** The one percentage of net sales a salesperson earns, set on their profile (design.md, Commissions). */
export function CommissionPercent({ userId }: { userId: string }) {
  const t = useTranslations('staff.commission');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const allowed = usePermission('commission:configure');
  const current = useStaffCommission(userId, allowed);
  const [percent, setPercent] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (current.data) setPercent(current.data.percent ?? '');
  }, [current.data]);

  if (!allowed) return null;

  async function save() {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const saved = await api.put<{ percent: string | null }>(`/staff/${userId}/commission`, {
        percent: percent === '' ? '0' : percent,
      });
      await queryClient.invalidateQueries({ queryKey: ['staff-commission', userId] });
      setNotice(saved.percent ? t('saved', { percent: saved.percent }) : t('switchedOff'));
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={`commission-${userId}`} className="flex flex-col gap-2">
      <h3 id={`commission-${userId}`} className="font-medium">
        {t('heading')}
      </h3>
      <p className="text-xs text-neutral-600">{t('hint')}</p>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex items-end gap-2">
        <Field id={`commission-percent-${userId}`} label={t('percent')}>
          <MoneyInput
            id={`commission-percent-${userId}`}
            value={percent}
            onChange={setPercent}
            decimals={2}
          />
        </Field>
        <Button type="button" variant="outline" disabled={saving} onClick={() => void save()}>
          {t('save')}
        </Button>
      </div>
    </section>
  );
}
