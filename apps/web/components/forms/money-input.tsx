'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import { Input } from '@/components/ui/input';

const PATTERN = /^-?\d*\.?\d*$/;

/**
 * Keeps an amount as a decimal STRING (never a JavaScript number) and tidies it to the workspace's
 * decimal places when the user leaves the field, rounding half up.
 */
export function normalizeAmount(text: string, decimals: number): string {
  if (!/^-?\d+(\.\d*)?$|^-?\.\d+$/.test(text)) return '';
  return new Decimal(text).toFixed(decimals, Decimal.ROUND_HALF_UP);
}

export function MoneyInput({
  id,
  value,
  onChange,
  decimals = 2,
  allowNegative = false,
  currencySymbol,
  disabled,
  ...aria
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  decimals?: number;
  allowNegative?: boolean;
  /** Shown before the amount, e.g. "Rs" or "$". */
  currencySymbol?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-2">
      {currencySymbol ? (
        <span aria-hidden="true" className="text-sm text-neutral-600">
          {currencySymbol}
        </span>
      ) : null}
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={draft ?? value}
        disabled={disabled}
        className="text-right tabular-nums"
        onChange={(event) => {
          const next = event.target.value;
          if (!PATTERN.test(next) || (!allowNegative && next.startsWith('-'))) return;
          setDraft(next);
          onChange(next);
        }}
        onBlur={() => {
          const tidy = normalizeAmount(draft ?? value, decimals);
          setDraft(null);
          onChange(tidy);
        }}
        {...aria}
      />
    </div>
  );
}
