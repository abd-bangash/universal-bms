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
import { useLocations, type LocationView } from '@/lib/hooks/use-inventory';
import { usePermission } from '@/lib/session';

const TYPES = ['STORE', 'WAREHOUSE', 'SHOWROOM', 'DAMAGED'] as const;

function LocationDialog({
  location,
  onClose,
}: {
  location: LocationView | null;
  onClose: () => void;
}) {
  const t = useTranslations('inventory.locations');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const [name, setName] = useState(location?.name ?? '');
  const [type, setType] = useState<LocationView['type']>(location?.type ?? 'STORE');
  const [isDefault, setIsDefault] = useState(location?.isDefault ?? false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      if (location)
        await api.patch(`/inventory/locations/${location.id}`, { name, type, isDefault });
      else await api.post('/inventory/locations', { name, type, isDefault });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <Modal open title={location ? t('editTitle') : t('addTitle')} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <Field id="loc-name" label={t('name')} required>
          <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="loc-type" label={t('type')}>
          <Select
            id="loc-type"
            value={type}
            onChange={(e) => setType(e.target.value as LocationView['type'])}
          >
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`types.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isDefault}
            disabled={location?.isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          {t('makeDefault')}
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

export function LocationManager() {
  const t = useTranslations('inventory.locations');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canConfigure = usePermission('workspace:configure');
  const locations = useLocations(true);
  const [editing, setEditing] = useState<LocationView | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(l: LocationView) {
    setError(null);
    try {
      await api.patch(`/inventory/locations/${l.id}`, { active: !l.active });
      await queryClient.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      setError(message(e));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canConfigure ? (
          <Button type="button" onClick={() => setEditing('new')}>
            {t('add')}
          </Button>
        ) : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <ul className="divide-y rounded border border-neutral-200">
        {(locations.data ?? []).map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <p className="font-medium">
              {l.name} <span className="text-neutral-600">· {t(`types.${l.type}`)}</span>
            </p>
            <div className="flex items-center gap-2">
              {l.isDefault ? <StatusBadge label={t('default')} color="#3b82f6" /> : null}
              {!l.active ? <StatusBadge label={t('inactive')} color="#a3a3a3" /> : null}
              {canConfigure ? (
                <>
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditing(l)}>
                    {t('edit')}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void toggle(l)}>
                    {l.active ? t('deactivate') : t('activate')}
                  </Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {editing ? (
        <LocationDialog
          location={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
