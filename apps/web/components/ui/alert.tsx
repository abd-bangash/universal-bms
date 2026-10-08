import * as React from 'react';
import { cn } from '@/lib/utils';

export function Alert({
  tone = 'error',
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: 'error' | 'info' | 'success' }) {
  const tones = {
    error: 'border-red-300 bg-red-50 text-red-900',
    info: 'border-blue-300 bg-blue-50 text-blue-900',
    success: 'border-green-300 bg-green-50 text-green-900',
  } as const;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2 text-sm', tones[tone], className)}
      {...props}
    />
  );
}
