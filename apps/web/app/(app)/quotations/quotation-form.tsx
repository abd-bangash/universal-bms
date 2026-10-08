'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { LineEditor, type OrderDiscountDraft } from '@/components/sales/line-editor';
import { CustomerPicker } from '@/components/sales/customer-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import {
  draftFromLine,
  toLineInput,
  usePricingPreview,
  type LineDraft,
  type QuotationView,
} from '@/lib/hooks/use-sales';
import { useTerminology } from '@/lib/terminology';

/** Create (quotation = null) or edit a draft or sent quotation (Requirement 10.1). */
export function QuotationForm({
  quotation,
  customer,
  onSaved,
}: {
  quotation: QuotationView | null;
  customer?: { id: string; fullName: string } | null;
  onSaved?: (q: QuotationView) => void;
}) {
  const t = useTranslations('sales.quotation.form');
  const term = useTerminology();
  const message = useErrorMessage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [party, setParty] = useState(customer ?? null);
  const [lines, setLines] = useState<LineDraft[]>((quotation?.items ?? []).map(draftFromLine));
  const [discount, setDiscount] = useState<OrderDiscountDraft>({
    type: quotation?.discountType ?? '',
    value: quotation?.discountType ? quotation.discountValue : '',
  });
  const [validUntil, setValidUntil] = useState(quotation?.validUntil?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(quotation?.notes ?? '');
  const [terms, setTerms] = useState(quotation?.terms ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const preview = usePricingPreview(
    lines,
    discount.type ? { type: discount.type, value: discount.value } : null,
    party?.id ?? null,
  );

  async function save() {
    setError(null);
    if (!quotation && !party) {
      setError(t('needCustomer'));
      return;
    }
    setSaving(true);
    try {
      const body = {
        lines: lines.map(toLineInput),
        orderDiscount: discount.type ? { type: discount.type, value: discount.value || '0' } : null,
        validUntil: validUntil || null,
        notes: notes.trim() || null,
        terms: terms.trim() || null,
      };
      if (quotation) {
        const saved = await api.patch<QuotationView>(`/quotations/${quotation.id}`, {
          ...body,
          version: quotation.version,
        });
        await queryClient.invalidateQueries({ queryKey: ['quotation'] });
        onSaved?.(saved);
      } else {
        const created = await api.post<QuotationView>('/quotations', {
          ...body,
          customerId: party?.id,
        });
        await queryClient.invalidateQueries({ queryKey: ['quotations'] });
        router.push(`/quotations/${created.id}`);
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      {!quotation ? (
        <div>
          <Link href="/quotations" className="text-sm underline">
            {t('back')}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">
            {t('title', { quotation: term('quotation').toLowerCase() })}
          </h1>
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}

      {quotation ? null : <CustomerPicker value={party} onChange={setParty} required />}

      <LineEditor
        entity="QUOTATION_ITEM"
        lines={lines}
        onChange={setLines}
        discount={discount}
        onDiscountChange={setDiscount}
        totals={preview.data}
      />

      <section className="grid gap-3 sm:grid-cols-2" aria-labelledby="quotation-details">
        <h2 id="quotation-details" className="font-medium sm:col-span-2">
          {t('details')}
        </h2>
        <Field id="quotation-valid" label={t('validUntil')}>
          <Input
            id="quotation-valid"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field id="quotation-notes" label={t('notes')}>
            <Textarea
              id="quotation-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field id="quotation-terms" label={t('terms')}>
            <Textarea
              id="quotation-terms"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
            />
          </Field>
        </div>
      </section>

      <div>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? t('saving') : quotation ? t('save') : t('create')}
        </Button>
      </div>
    </div>
  );
}
