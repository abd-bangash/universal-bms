export interface NumberingFormat {
  prefix: string;
  includeYear: boolean;
  padding: number;
}

/** What the next document number will look like, e.g. `QT-2026-0001` (same rule the API uses). */
export function numberExample(
  format: NumberingFormat,
  year: number = new Date().getFullYear(),
  counter = 1,
): string {
  const padding = Number.isInteger(format.padding) && format.padding > 0 ? format.padding : 1;
  return `${format.prefix}${format.includeYear ? `${year}-` : ''}${String(counter).padStart(padding, '0')}`;
}
