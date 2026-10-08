/**
 * RFC 4180 cells, hardened against spreadsheet formula injection: a cell that starts with a
 * character a spreadsheet would run as a formula is prefixed with an apostrophe (OWASP guidance).
 */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const csvLine = (cells: readonly unknown[]): string => `${cells.map(csvCell).join(',')}\r\n`;
