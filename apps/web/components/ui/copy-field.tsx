'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from './button';
import { Input } from './input';

/** A read-only value (a link, a token) with a copy button. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const t = useTranslations('staff');
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
    </div>
  );
}
