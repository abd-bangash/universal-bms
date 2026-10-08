'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import {
  useAccounts,
  usePaymentMethods,
  type AccountView,
  type MethodView,
} from '@/lib/hooks/use-finance';
import { usePermission } from '@/lib/session';

const ACCOUNT_TYPES = ['CASH', 'BANK', 'MOBILE_WALLET', 'CARD_TERMINAL'] as const;
const METHOD_TYPES = ['CASH', 'CARD', 'BANK_TRANSFER', 'MOBILE_MONEY', 'OTHER'] as const;

function AccountDialog({ account, onClose }: { account: AccountView | null; onClose: () => void }) {
  const t = useTranslations('finance.accounts.accountForm');
  const ta = useTranslations('finance.accounts.accountType');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [type, setType] = useState<AccountView['type']>(account?.type ?? 'BANK');
  const [name, setName] = useState(account?.name ?? '');
  const [bankName, setBankName] = useState(account?.bankName ?? '');
  const [title, setTitle] = useState(account?.accountTitle ?? '');
  const [number, setNumber] = useState(account?.accountNumber ?? '');
  const [branch, setBranch] = useState(account?.branch ?? '');
  const [show, setShow] = useState(account?.showToCustomers ?? false);
  const [error, setError] = useState<string | null>(null);
  const hasDetails = type === 'BANK' || type === 'MOBILE_WALLET';

  async function save() {
    setError(null);
    const details = hasDetails
      ? {
          bankName: bankName || null,
          accountTitle: title || null,
          accountNumber: number || null,
          branch: branch || null,
        }
      : {};
    try {
      if (account) {
        await api.patch(`/settings/financial-accounts/${account.id}`, {
          name,
          showToCustomers: show,
          ...details,
        });
      } else {
        await api.post('/settings/financial-accounts', {
          type,
          name,
          showToCustomers: show,
          ...details,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <Modal open title={account ? t('editTitle') : t('addTitle')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        {!account ? (
          <Field id="acc-type" label={t('type')}>
            <Select
              id="acc-type"
              value={type}
              onChange={(e) => setType(e.target.value as AccountView['type'])}
            >
              {ACCOUNT_TYPES.map((x) => (
                <option key={x} value={x}>
                  {ta(x)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field id="acc-name" label={t('name')} required>
          <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {hasDetails ? (
          <>
            <Field id="acc-bank" label={t('bankName')}>
              <Input id="acc-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} />
            </Field>
            <Field id="acc-title" label={t('accountTitle')}>
              <Input id="acc-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field id="acc-number" label={t('accountNumber')}>
              <Input id="acc-number" value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
            <Field id="acc-branch" label={t('branch')}>
              <Input id="acc-branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
            </Field>
          </>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
          {t('showToCustomers')}
        </label>
        <div className="flex justify-end">
          <Button type="button" disabled={name.trim() === ''} onClick={() => void save()}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MethodDialog({
  method,
  accounts,
  onClose,
}: {
  method: MethodView | null;
  accounts: AccountView[];
  onClose: () => void;
}) {
  const t = useTranslations('finance.accounts.methodForm');
  const tm = useTranslations('finance.accounts.methodType');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [name, setName] = useState(method?.name ?? '');
  const [type, setType] = useState<MethodView['type']>(method?.type ?? 'BANK_TRANSFER');
  const [accountId, setAccountId] = useState(method?.accountId ?? accounts[0]?.id ?? '');
  const [requiresReference, setRequiresReference] = useState(method?.requiresReference ?? false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      const body = { name, type, accountId, requiresReference };
      if (method) await api.patch(`/settings/payment-methods/${method.id}`, body);
      else await api.post('/settings/payment-methods', body);
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
      onClose();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <Modal open title={method ? t('editTitle') : t('addTitle')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <Field id="meth-name" label={t('name')} required>
          <Input id="meth-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="meth-type" label={t('type')}>
          <Select
            id="meth-type"
            value={type}
            onChange={(e) => setType(e.target.value as MethodView['type'])}
          >
            {METHOD_TYPES.map((x) => (
              <option key={x} value={x}>
                {tm(x)}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="meth-account" label={t('account')} required>
          <Select
            id="meth-account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts
              .filter((a) => a.active)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiresReference}
            onChange={(e) => setRequiresReference(e.target.checked)}
          />
          {t('requiresReference')}
        </label>
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={name.trim() === '' || !accountId}
            onClick={() => void save()}
          >
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Accounts and payment methods: set up once, used by every payment and expense (Requirement 40). */
export function AccountsManager() {
  const t = useTranslations('finance.accounts');
  const ta = useTranslations('finance.accounts.accountType');
  const tm = useTranslations('finance.accounts.methodType');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canConfigure = usePermission('account:configure');
  const accounts = useAccounts(true);
  const methods = usePaymentMethods(true);
  const [editAccount, setEditAccount] = useState<AccountView | 'new' | null>(null);
  const [editMethod, setEditMethod] = useState<MethodView | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(path: string, active: boolean) {
    setError(null);
    try {
      await api.patch(path, { active });
      await queryClient.invalidateQueries({ queryKey: ['finance'] });
    } catch (e) {
      setError(message(e));
    }
  }

  const accountList = accounts.data ?? [];
  return (
    <div className="flex flex-col gap-8">
      {error ? <Alert>{error}</Alert> : null}
      <section aria-labelledby="accounts-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h1 id="accounts-heading" className="text-2xl font-semibold">
            {t('accounts')}
          </h1>
          {canConfigure ? (
            <Button type="button" onClick={() => setEditAccount('new')}>
              {t('addAccount')}
            </Button>
          ) : null}
        </div>
        <ul className="divide-y rounded border border-neutral-200">
          {accountList.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {a.name} <span className="text-neutral-600">· {ta(a.type)}</span>
                </p>
                <p className="text-neutral-600">
                  {[a.bankName, a.accountTitle, a.accountNumber, a.branch]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {a.showToCustomers ? (
                  <StatusBadge label={t('customerFacing')} color="#3b82f6" />
                ) : null}
                {!a.active ? <StatusBadge label={t('inactive')} color="#a3a3a3" /> : null}
                {canConfigure ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditAccount(a)}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void toggle(`/settings/financial-accounts/${a.id}`, !a.active)}
                    >
                      {a.active ? t('deactivate') : t('activate')}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="methods-heading" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="methods-heading" className="text-xl font-semibold">
            {t('methods')}
          </h2>
          {canConfigure ? (
            <Button type="button" onClick={() => setEditMethod('new')}>
              {t('addMethod')}
            </Button>
          ) : null}
        </div>
        <ul className="divide-y rounded border border-neutral-200">
          {(methods.data ?? []).map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {m.name} <span className="text-neutral-600">· {tm(m.type)}</span>
                </p>
                <p className="text-neutral-600">
                  {accountList.find((a) => a.id === m.accountId)?.name}
                  {m.requiresReference ? ` · ${t('needsReference')}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!m.active ? <StatusBadge label={t('inactive')} color="#a3a3a3" /> : null}
                {canConfigure ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setEditMethod(m)}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void toggle(`/settings/payment-methods/${m.id}`, !m.active)}
                    >
                      {m.active ? t('deactivate') : t('activate')}
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>
      {editAccount ? (
        <AccountDialog
          account={editAccount === 'new' ? null : editAccount}
          onClose={() => setEditAccount(null)}
        />
      ) : null}
      {editMethod ? (
        <MethodDialog
          method={editMethod === 'new' ? null : editMethod}
          accounts={accountList}
          onClose={() => setEditMethod(null)}
        />
      ) : null}
    </div>
  );
}
