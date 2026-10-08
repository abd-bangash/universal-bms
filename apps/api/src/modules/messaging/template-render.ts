/** The variables a message template may use (design.md "Channels and Integrations", Templates). */
export const TEMPLATE_VARIABLES = [
  'customer_name',
  'order_number',
  'order_total',
  'balance_due',
  'business_name',
  'bank_details',
  'follow_up_date',
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** The placeholder names in a body, in the order they first appear. */
export function variablesOf(body: string): string[] {
  const seen: string[] = [];
  for (const match of body.matchAll(PLACEHOLDER)) {
    const name = match[1] as string;
    if (!seen.includes(name)) seen.push(name);
  }
  return seen;
}

export interface Rendered {
  text: string;
  /** Placeholders that had no value; a message with any of these must not be sent. */
  unresolved: string[];
}

/** Fills the placeholders from `values`; one with no value (or an empty one) is reported, never sent as blank. */
export function renderTemplate(body: string, values: Record<string, string | undefined>): Rendered {
  const unresolved: string[] = [];
  const text = body.replace(PLACEHOLDER, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined || value.trim() === '') {
      if (!unresolved.includes(name)) unresolved.push(name);
      return '';
    }
    return value;
  });
  return { text, unresolved };
}
