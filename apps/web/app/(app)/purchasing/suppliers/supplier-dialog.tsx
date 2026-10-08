'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/error-message';
import type { SupplierView } from '@/lib/hooks/use-purchasing';

/** Adds a supplier, or edits one (Requirement 7.8). */
export function SupplierDialog({
  open,
  onClose,
  supplier,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  supplier?: SupplierView;
  onSaved?: (supplier: SupplierView) => void;
}) {
  const t = useTranslations('purchasing.supplier');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [name, setName] = useState(supplier?.name ?? '');
  const [contactName, setContactName] = useState(supplier?.contactName ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setErrors({});
    if (name.trim() === '') {
      setErrors({ name: [t('nameRequired')] });
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        contactName: contactName.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        notes: notes.trim() || null,
      };
      const saved = supplier
        ? await api.patch<SupplierView>(`/suppliers/${supplier.id}`, body)
        : await api.post<SupplierView>('/suppliers', body);
      await Promise.all(
        [['supplier'], ['purchasing'], ['list', 'suppliers']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.details);
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  const first = (field: string) => errors[field]?.[0];
  return (
    <Modal open={open} title={supplier ? t('editTitle') : t('newTitle')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <Field id="sup-name" label={t('name')} required error={first('name')}>
          <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="sup-contact" label={t('contactName')}>
          <Input
            id="sup-contact"
            value={contactName}
            onChange={(e) => setContactName(e.target.value)}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="sup-phone" label={t('phone')}>
            <Input id="sup-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
          <Field id="sup-email" label={t('email')} error={first('email')}>
            <Input id="sup-email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
        <Field id="sup-address" label={t('address')}>
          <Textarea id="sup-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <Field id="sup-notes" label={t('notes')}>
          <Textarea id="sup-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
