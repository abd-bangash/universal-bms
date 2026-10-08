'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { isVisible, type Condition } from '@bms/calc';
import { FileUpload } from '@/components/forms/file-upload';
import { MoneyInput } from '@/components/forms/money-input';
import { Field, describedBy } from '@/components/ui/label';
import { Input, Select } from '@/components/ui/input';

export type FieldType =
  | 'TEXT'
  | 'NUMBER'
  | 'DATE'
  | 'BOOLEAN'
  | 'DROPDOWN'
  | 'MULTI_SELECT'
  | 'MEASUREMENT'
  | 'CURRENCY'
  | 'IMAGE'
  | 'REFERENCE';

/** A Field_Definition as returned by GET /fields. */
export interface FieldDefinitionView {
  key: string;
  label: string;
  type: FieldType;
  unitDimension?: string | null;
  defaultUnit?: string | null;
  options?: Array<{ key: string; label: string }>;
  required?: boolean;
  categoryId?: string | null;
  visibleWhen?: Condition | null;
  sortOrder?: number;
  active?: boolean;
}

export interface UnitOption {
  symbol: string;
  name: string;
  dimension: string;
}

export type FieldValues = Record<string, unknown>;

export interface DynamicFieldsProps {
  definitions: FieldDefinitionView[];
  values: FieldValues;
  onChange: (values: FieldValues) => void;
  /** Messages by field key, for example the API's field-level errors. */
  errors?: Record<string, string | undefined>;
  /** Facts about the record that visibility conditions may refer to. */
  context?: { productType?: string | null; categoryId?: string | null; status?: string | null };
  units?: UnitOption[];
  currencyDecimals?: number;
  disabled?: boolean;
  idPrefix?: string;
}

/**
 * The one component that renders custom fields on every entity form (Requirement 49.11). Which
 * fields appear is decided by the same `isVisible` function the API uses (Requirement 26.5).
 */
export function DynamicFields({
  definitions,
  values,
  onChange,
  errors = {},
  context = {},
  units = [],
  currencyDecimals = 2,
  disabled,
  idPrefix = 'cf',
}: DynamicFieldsProps) {
  const t = useTranslations('fields');
  const visible = useMemo(
    () =>
      definitions
        .filter((d) => d.active !== false)
        .filter((d) =>
          isVisible(
            { visibleWhen: d.visibleWhen, categoryId: d.categoryId },
            { values, ...context },
          ),
        )
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [definitions, values, context],
  );

  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <>
      {visible.map((def) => {
        const id = `${idPrefix}-${def.key}`;
        const error = errors[def.key];
        const aria = describedBy(id, { error });
        const value = values[def.key];
        return (
          <Field key={def.key} id={id} label={def.label} error={error} required={def.required}>
            {renderControl(def, value, aria, { set, t, units, currencyDecimals, disabled })}
          </Field>
        );
      })}
    </>
  );
}

type Aria = ReturnType<typeof describedBy>;

function renderControl(
  def: FieldDefinitionView,
  value: unknown,
  aria: Aria,
  env: {
    set: (key: string, value: unknown) => void;
    t: ReturnType<typeof useTranslations>;
    units: UnitOption[];
    currencyDecimals: number;
    disabled?: boolean;
  },
) {
  const { set, t, units, currencyDecimals, disabled } = env;
  switch (def.type) {
    case 'TEXT':
      return (
        <Input
          {...aria}
          disabled={disabled}
          value={asText(value)}
          onChange={(e) => set(def.key, e.target.value)}
        />
      );
    case 'NUMBER':
      return (
        <Input
          {...aria}
          disabled={disabled}
          inputMode="decimal"
          value={asText(value)}
          onChange={(e) => /^-?\d*\.?\d*$/.test(e.target.value) && set(def.key, e.target.value)}
        />
      );
    case 'DATE':
      return (
        <Input
          {...aria}
          disabled={disabled}
          type="date"
          value={asText(value)}
          onChange={(e) => set(def.key, e.target.value)}
        />
      );
    case 'BOOLEAN':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            {...aria}
            type="checkbox"
            disabled={disabled}
            checked={value === true}
            onChange={(e) => set(def.key, e.target.checked)}
          />
          {value === true ? t('yes') : t('no')}
        </label>
      );
    case 'DROPDOWN':
      return (
        <Select
          {...aria}
          disabled={disabled}
          value={asText(value)}
          onChange={(e) => set(def.key, e.target.value)}
        >
          <option value="">{t('choose')}</option>
          {(def.options ?? []).map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </Select>
      );
    case 'MULTI_SELECT': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div role="group" aria-labelledby={aria.id} className="flex flex-wrap gap-3">
          {(def.options ?? []).map((o) => (
            <label key={o.key} className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={chosen.includes(o.key)}
                onChange={(e) =>
                  set(
                    def.key,
                    e.target.checked ? [...chosen, o.key] : chosen.filter((k) => k !== o.key),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case 'MEASUREMENT': {
      const current = (value ?? {}) as { value?: string; unit?: string };
      const options = units.filter((u) => !def.unitDimension || u.dimension === def.unitDimension);
      const unit = current.unit ?? def.defaultUnit ?? options[0]?.symbol ?? '';
      return (
        <div className="flex gap-2">
          <Input
            {...aria}
            disabled={disabled}
            inputMode="decimal"
            aria-label={`${def.label} ${t('value')}`}
            value={current.value ?? ''}
            onChange={(e) =>
              /^\d*\.?\d*$/.test(e.target.value) && set(def.key, { value: e.target.value, unit })
            }
          />
          <Select
            disabled={disabled}
            aria-label={`${def.label} ${t('unit')}`}
            className="w-28"
            value={unit}
            onChange={(e) => set(def.key, { value: current.value ?? '', unit: e.target.value })}
          >
            {(options.length > 0 ? options : [{ symbol: unit, name: unit, dimension: '' }]).map(
              (u) => (
                <option key={u.symbol} value={u.symbol}>
                  {u.symbol}
                </option>
              ),
            )}
          </Select>
        </div>
      );
    }
    case 'CURRENCY':
      return (
        <MoneyInput
          id={aria.id}
          aria-invalid={aria['aria-invalid']}
          aria-describedby={aria['aria-describedby']}
          disabled={disabled}
          decimals={currencyDecimals}
          value={asText(value)}
          onChange={(v) => set(def.key, v)}
        />
      );
    case 'IMAGE':
      return (
        <div className="flex flex-col gap-1">
          {typeof value === 'string' && value ? (
            <span className="text-xs text-neutral-600">{value}</span>
          ) : null}
          <FileUpload
            accept="image/jpeg,image/png,image/webp"
            purpose="reference"
            onUploaded={(file) => set(def.key, file.id)}
          />
        </div>
      );
    case 'REFERENCE': {
      const ref = (value ?? {}) as { entityType?: string; id?: string };
      return (
        <Input
          {...aria}
          disabled={disabled}
          aria-label={`${def.label} ${t('referenceId')}`}
          value={ref.id ?? ''}
          onChange={(e) => set(def.key, { entityType: ref.entityType ?? '', id: e.target.value })}
        />
      );
    }
  }
}

const asText = (v: unknown): string =>
  typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
