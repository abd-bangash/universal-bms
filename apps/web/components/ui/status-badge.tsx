import { cn } from '@/lib/utils';

/** Black or white, whichever reads better on the given #RRGGBB background. */
export function readableTextColor(hex: string): '#000000' | '#ffffff' {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '#000000';
  const n = parseInt(match[1] as string, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.4 ? '#000000' : '#ffffff';
}

/** A workflow state shown as a coloured pill; the colour comes from the workspace's workflow. */
export function StatusBadge({
  label,
  color = '#64748b',
  className,
}: {
  label: string;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{ backgroundColor: color, color: readableTextColor(color) }}
    >
      {label}
    </span>
  );
}
