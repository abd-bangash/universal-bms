'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CustomerPicker } from '@/components/sales/customer-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { conversationTitle, type ConversationView } from '@/lib/hooks/use-conversations';
import { usePermission } from '@/lib/session';

/** Who the conversation is with, and what to do about them: link a customer, make a lead, start an order. */
export function ContactPanel({ conversation: c }: { conversation: ConversationView }) {
  const t = useTranslations('conversations.contact');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canLink = usePermission('conversation:assign');
  const canCreateLead = usePermission('lead:create') && canLink;
  const canOrder = usePermission('order:create');
  const [linking, setLinking] = useState(false);
  const [picked, setPicked] = useState<{ id: string; fullName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      setLinking(false);
      setPicked(null);
      await queryClient.invalidateQueries({ queryKey: ['conversations'] });
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <aside aria-label={t('title')}>
      <Card>
        <div className="flex flex-col gap-3 text-sm">
          <h3 className="font-medium">{t('title')}</h3>
          <dl className="flex flex-col gap-1">
            <div>
              <dt className="text-neutral-500">{c.customerId ? t('customer') : t('lead')}</dt>
              <dd>{conversationTitle(c)}</dd>
            </div>
            {c.contactPhone ? (
              <div>
                <dt className="text-neutral-500">{t('phone')}</dt>
                <dd>{c.contactPhone}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-neutral-500">{t('channel')}</dt>
              <dd>{c.channelType}</dd>
            </div>
          </dl>
          {error ? <Alert>{error}</Alert> : null}
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {!c.customerId ? <p className="text-neutral-600">{t('notLinked')}</p> : null}
          <div className="flex flex-col gap-2">
            {c.customerId ? (
              <Link className="underline" href={`/customers/${c.customerId}`}>
                {t('openCustomer')}
              </Link>
            ) : null}
            {c.leadId ? (
              <Link className="underline" href={`/leads/${c.leadId}`}>
                {t('openLead')}
              </Link>
            ) : null}
            {c.customerId && canOrder ? (
              <Link className="underline" href="/orders/new">
                {t('newOrder')}
              </Link>
            ) : null}
            {canLink && !c.customerId ? (
              linking ? (
                <div className="flex flex-col gap-2">
                  <CustomerPicker value={picked} onChange={setPicked} />
                  {picked ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        void run(
                          () => api.patch(`/conversations/${c.id}`, { customerId: picked.id }),
                          t('linked'),
                        )
                      }
                    >
                      {t('linkCustomer')}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setLinking(true)}>
                  {t('linkCustomer')}
                </Button>
              )
            ) : null}
            {canCreateLead && !c.leadId ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void run(async () => {
                    const lead = await api.post<{ id: string }>('/leads', {
                      fullName: conversationTitle(c),
                      phone: c.contactPhone ? `+${c.contactPhone.replace(/^\+/, '')}` : undefined,
                      source: 'MESSAGING',
                      channel: c.channelType,
                      allowDuplicate: true,
                    });
                    await api.patch(`/conversations/${c.id}`, { leadId: lead.id });
                  }, t('leadCreated'))
                }
              >
                {t('createLead')}
              </Button>
            ) : null}
          </div>
        </div>
      </Card>
    </aside>
  );
}
