'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import type { CustomerView } from '@/lib/hooks/use-crm';

/** Search customers by name, phone or email; shows the chosen one. */
export function CustomerPicker({
  value,
  onChange,
  disabled,
  required,
}: {
  value: { id: string; fullName: string } | null;
  onChange: (customer: { id: string; fullName: string } | null) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const t = useTranslations('sales.customer');
  const [q, setQ] = useState('');
  const text = q.trim();
  const results = useQuery({
    queryKey: ['customer-pick', text],
    enabled: text.length >= 2,
    queryFn: ({ signal }) => api.get<CustomerView[]>('/customers', { q: text, limit: 8 }, signal),
  });
  if (value) {
    return (
      <div className="flex items-center gap-3">
        <div>
          <p className="text-sm font-medium">{t('label')}</p>
          <p>{value.fullName}</p>
        </div>
        {!disabled ? (
          <button type="button" className="text-sm underline" onClick={() => onChange(null)}>
            {t('change')}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Field id="customer-search" label={t('label')} required={required}>
        <Input
          id="customer-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('placeholder')}
          autoComplete="off"
          disabled={disabled}
        />
      </Field>
      {results.data && results.data.length > 0 ? (
        <ul aria-label={t('results')} className="divide-y rounded border border-neutral-200">
          {results.data.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-start text-sm hover:bg-neutral-50"
                onClick={() => {
                  onChange({ id: c.id, fullName: c.fullName });
                  setQ('');
                }}
              >
                {c.fullName}
                <span className="ms-2 text-neutral-600">{c.phones[0] ?? c.email ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
