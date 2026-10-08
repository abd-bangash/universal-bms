'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { MoneyInput } from '@/components/forms/money-input';
import { CustomerPicker } from '@/components/sales/customer-picker';
import { TotalsPanel } from '@/components/sales/line-editor';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { ApiError } from '@/lib/errors';
import { formatMoney } from '@/lib/format';
import { useStaffQuery } from '@/lib/hooks/use-crm';
import { newIdempotencyKey, usePaymentMethods } from '@/lib/hooks/use-finance';
import { openReceiptPdf, type CheckoutBody, type CheckoutResult } from '@/lib/hooks/use-pos';
import {
  draftFromVariant,
  toLineInput,
  usePricingPreview,
  useVariantSearch,
  type LineDraft,
  type VariantPick,
} from '@/lib/hooks/use-sales';
import { usePermission, useSession, useWorkspaceLocale } from '@/lib/session';
import { PayDialog, type PaymentChoice } from './pay-dialog';

/**
 * The counter screen (Requirement 12). Keyboard first: the search box has the focus; Enter adds
 * the exact barcode or SKU match, else the first result; F2 returns to search; F4 takes payment.
 * The cart stays on screen through any failure, and a retry reuses the sale's idempotency key so
 * the customer is never charged twice (Requirement 54.1).
 */
export function PosScreen() {
  const t = useTranslations('pos.screen');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const me = useSession();
  const canOverride = usePermission('order:price_override');
  const canSeeStaff = usePermission('user:view');
  const staff = useStaffQuery(canSeeStaff);
  const methods = usePaymentMethods();

  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [discountType, setDiscountType] = useState<'' | 'AMOUNT' | 'PERCENT'>('');
  const [discountValue, setDiscountValue] = useState('');
  const [customer, setCustomer] = useState<{ id: string; fullName: string } | null>(null);
  const [salespersonId, setSalespersonId] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [done, setDone] = useState<(CheckoutResult & { receiptOpened: boolean }) | null>(null);
  // the last request sent and its key: the same request is retried with the same key
  const attempt = useRef<{ signature: string; key: string; body: CheckoutBody } | null>(null);

  const results = useVariantSearch(q);
  const discount = discountType ? { type: discountType, value: discountValue || '0' } : null;
  const preview = usePricingPreview(lines, discount, customer?.id ?? null);
  const cashPreview = usePricingPreview(lines, discount, customer?.id ?? null, true);
  const total = preview.data?.total ?? '0';
  const cashTotal = cashPreview.data?.total ?? total;

  useEffect(() => {
    searchRef.current?.focus();
  }, [done]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F4' && lines.length > 0 && !done) {
        e.preventDefault();
        setPayOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines.length, done]);

  function add(v: VariantPick) {
    setLines((current) => {
      const existing = current.find((l) => l.kind === 'CATALOG' && l.variantId === v.variantId);
      if (!existing) return [...current, draftFromVariant(v)];
      return current.map((l) =>
        l === existing ? { ...l, quantity: String(Number(l.quantity || '0') + 1) } : l,
      );
    });
    setQ('');
    setSearchNote(null);
  }

  async function submitSearch() {
    const code = q.trim();
    if (!code) return;
    try {
      add(await api.get<VariantPick>('/catalog/variants/lookup', { code }));
      return;
    } catch {
      // not an exact barcode or SKU: fall back to the search results
    }
    const found = results.data?.[0];
    if (found) add(found);
    else setSearchNote(t('notFound'));
  }

  const update = (key: string, patch: Partial<LineDraft>) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  function buildBody(payment: PaymentChoice): CheckoutBody {
    return {
      lines: lines.map(toLineInput),
      ...(discount ? { orderDiscount: discount } : {}),
      ...(customer ? { customerId: customer.id } : {}),
      ...(salespersonId ? { salespersonId } : {}),
      payment,
    };
  }

  async function send(body: CheckoutBody) {
    const signature = JSON.stringify(body);
    if (attempt.current?.signature !== signature) {
      attempt.current = { signature, key: newIdempotencyKey(), body };
    }
    const { key } = attempt.current;
    setPending(true);
    setPayError(null);
    setUnreachable(false);
    try {
      const result = await api.post<CheckoutResult>('/pos/checkout', body, {
        headers: { 'Idempotency-Key': key },
      });
      attempt.current = null;
      setPayOpen(false);
      let receiptOpened = true;
      try {
        await openReceiptPdf(result.receipt.id);
      } catch {
        // the sale stands; the receipt can be drawn again from the history (Requirement 54.3)
        receiptOpened = false;
      }
      setDone({ ...result, receiptOpened });
      void queryClient.invalidateQueries({ queryKey: ['list', 'pos-receipts'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NETWORK_ERROR') setUnreachable(true);
      else setPayError(message(e));
    } finally {
      setPending(false);
    }
  }

  function newSale() {
    setLines([]);
    setDiscountType('');
    setDiscountValue('');
    setCustomer(null);
    setSalespersonId('');
    setDone(null);
    attempt.current = null;
  }

  const ready = lines.length > 0 && !!preview.data && lines.every((l) => Number(l.quantity) > 0);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="sr-only">{t('title')}</h1>
      {done ? (
        <Alert tone="success">
          <p className="font-medium">
            {t('saleComplete', {
              number: done.order.orderNumber,
              receipt: done.receipt.receiptNumber,
            })}
          </p>
          <p>
            {t('changeDue')}: <strong>{formatMoney(done.changeDue, locale)}</strong>
          </p>
          {!done.receiptOpened ? <p>{t('receiptFailed')}</p> : null}
          <div className="mt-2 flex gap-2">
            <Button type="button" onClick={newSale} autoFocus>
              {t('newSale')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void openReceiptPdf(done.receipt.id).catch(() => undefined)}
            >
              {t('openReceipt')}
            </Button>
          </div>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <section aria-label={t('cart')} className="flex flex-col gap-3">
          <Field id="pos-search" label={t('search')} hint={t('searchHint')}>
            <Input
              id="pos-search"
              ref={searchRef}
              value={q}
              disabled={!!done}
              onChange={(e) => {
                setQ(e.target.value);
                setSearchNote(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void submitSearch();
                }
              }}
              placeholder={t('searchPlaceholder')}
              autoComplete="off"
            />
          </Field>
          {searchNote ? <p className="text-sm text-neutral-600">{searchNote}</p> : null}
          {q.trim().length >= 2 && results.data && results.data.length > 0 ? (
            <ul aria-label={t('results')} className="divide-y rounded border border-neutral-200">
              {results.data.map((v) => (
                <li key={v.variantId}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-neutral-50"
                    onClick={() => {
                      add(v);
                      searchRef.current?.focus();
                    }}
                  >
                    <span>
                      {v.variantName ? `${v.productName} · ${v.variantName}` : v.productName}
                      <span className="ms-2 text-neutral-600">{v.sku}</span>
                    </span>
                    <span className="tabular-nums">{formatMoney(v.price, locale)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {lines.length === 0 ? (
            <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-600">
              {t('emptyCart')}
            </p>
          ) : (
            <ol className="flex flex-col gap-2">
              {lines.map((line, index) => (
                <li
                  key={line.key}
                  className="grid items-end gap-2 rounded border border-neutral-200 p-2 sm:grid-cols-[1fr_5rem_7rem_9rem_auto]"
                >
                  <div>
                    <p className="font-medium">{line.name}</p>
                    <p className="text-xs text-neutral-600">{line.sku}</p>
                  </div>
                  <Field id={`${line.key}-qty`} label={t('qty')}>
                    <MoneyInput
                      id={`${line.key}-qty`}
                      value={line.quantity}
                      onChange={(quantity) => update(line.key, { quantity })}
                      decimals={0}
                      disabled={!!done}
                    />
                  </Field>
                  <Field id={`${line.key}-price`} label={t('price')}>
                    <MoneyInput
                      id={`${line.key}-price`}
                      value={line.unitPrice !== '' ? line.unitPrice : line.listPrice}
                      onChange={(unitPrice) => update(line.key, { unitPrice })}
                      decimals={locale.currencyDecimals}
                      disabled={!!done || !canOverride}
                    />
                  </Field>
                  <div className="flex gap-1">
                    <Field id={`${line.key}-dtype`} label={t('discount')}>
                      <Select
                        id={`${line.key}-dtype`}
                        value={line.discountType}
                        disabled={!!done}
                        onChange={(e) =>
                          update(line.key, {
                            discountType: e.target.value as LineDraft['discountType'],
                          })
                        }
                      >
                        <option value="">—</option>
                        <option value="PERCENT">%</option>
                        <option value="AMOUNT">{locale.currency}</option>
                      </Select>
                    </Field>
                    {line.discountType ? (
                      <Field id={`${line.key}-dvalue`} label={t('discountValue')}>
                        <MoneyInput
                          id={`${line.key}-dvalue`}
                          value={line.discountValue}
                          onChange={(discountValue) => update(line.key, { discountValue })}
                          decimals={line.discountType === 'PERCENT' ? 2 : locale.currencyDecimals}
                          disabled={!!done}
                        />
                      </Field>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!!done}
                    aria-label={t('remove', { n: index + 1 })}
                    onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                  >
                    {t('removeShort')}
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="flex flex-col gap-4 rounded border border-neutral-200 p-4">
          <CustomerPicker value={customer} onChange={setCustomer} disabled={!!done} />
          {!customer ? <p className="-mt-2 text-xs text-neutral-600">{t('walkIn')}</p> : null}
          {canSeeStaff ? (
            <Field id="pos-salesperson" label={t('salesperson')}>
              <Select
                id="pos-salesperson"
                value={salespersonId}
                disabled={!!done}
                onChange={(e) => setSalespersonId(e.target.value)}
              >
                <option value="">
                  {t('salespersonDefault', { name: `${me.user.firstName} ${me.user.lastName}` })}
                </option>
                {(staff.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName} {s.lastName}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Field id="pos-order-dtype" label={t('orderDiscount')}>
              <Select
                id="pos-order-dtype"
                value={discountType}
                disabled={!!done}
                onChange={(e) => setDiscountType(e.target.value as typeof discountType)}
              >
                <option value="">—</option>
                <option value="PERCENT">%</option>
                <option value="AMOUNT">{locale.currency}</option>
              </Select>
            </Field>
            {discountType ? (
              <Field id="pos-order-dvalue" label={t('discountValue')}>
                <MoneyInput
                  id="pos-order-dvalue"
                  value={discountValue}
                  onChange={setDiscountValue}
                  decimals={discountType === 'PERCENT' ? 2 : locale.currencyDecimals}
                  disabled={!!done}
                />
              </Field>
            ) : null}
          </div>
          <TotalsPanel totals={preview.data} />
          <Button
            type="button"
            disabled={!ready || !!done || methods.isPending}
            onClick={() => {
              setPayError(null);
              setUnreachable(false);
              setPayOpen(true);
            }}
          >
            {t('pay')} <span className="ms-2 text-xs opacity-70">F4</span>
          </Button>
        </aside>
      </div>

      {payOpen && !done ? (
        <PayDialog
          open
          onClose={() => setPayOpen(false)}
          methods={methods.data ?? []}
          total={total}
          cashTotal={cashTotal}
          pending={pending}
          error={payError}
          unreachable={unreachable}
          onConfirm={(payment) => void send(buildBody(payment))}
          onRetry={() => attempt.current && void send(attempt.current.body)}
        />
      ) : null}
    </div>
  );
}
