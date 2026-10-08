import { createElement as h, type ReactElement, type ReactNode } from 'react';
import type { DocumentProps, Styles } from '@react-pdf/renderer';
import type { DocumentSnapshot, RenderOptions } from './document.types';
import { formatAddress, formatDate, formatMoney, formatPercent, formatQuantity } from './format';

// The components of @react-pdf/renderer are string tags the renderer recognises. Using the tags
// keeps this file free of the library itself (which only loads as an ES module), so the layout
// can be built and inspected anywhere.
const Document = 'DOCUMENT';
const Page = 'PAGE';
const View = 'VIEW';
const Text = 'TEXT';
const Image = 'IMAGE';

const styles: Styles = {
  page: { padding: 36, fontSize: 9, fontFamily: 'Helvetica', color: '#1f2937' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  logo: { width: 90, height: 45, objectFit: 'contain', marginBottom: 6 },
  business: { fontSize: 13, fontWeight: 700, marginBottom: 2 },
  title: { fontSize: 20, fontWeight: 700, textAlign: 'right', marginBottom: 4 },
  meta: { textAlign: 'right', marginBottom: 1 },
  muted: { color: '#6b7280' },
  parties: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  party: { width: '48%' },
  label: { fontSize: 8, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 },
  tableHead: {
    flexDirection: 'row',
    backgroundColor: '#f3f4f6',
    paddingVertical: 4,
    paddingHorizontal: 4,
    fontWeight: 700,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e5e7eb',
  },
  cNo: { width: '5%' },
  cItem: { width: '41%' },
  cQty: { width: '9%', textAlign: 'right' },
  cPrice: { width: '15%', textAlign: 'right' },
  cDisc: { width: '12%', textAlign: 'right' },
  cTotal: { width: '18%', textAlign: 'right' },
  field: { color: '#6b7280', fontSize: 8 },
  totals: { alignSelf: 'flex-end', width: '45%', marginTop: 10 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  grand: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
    fontSize: 11,
    fontWeight: 700,
  },
  section: { marginTop: 14 },
  sectionTitle: { fontWeight: 700, marginBottom: 3 },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    fontSize: 8,
    color: '#6b7280',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
};

type Style = Styles[string];
type Child = ReactNode;
const view = (style: Style, ...children: Child[]) => h(View, { style }, ...children);
const text = (style: Style | null, ...children: Child[]) =>
  h(Text, { style: style ?? undefined }, ...children);

const DEFAULT_LABELS: Record<DocumentSnapshot['type'], string> = {
  QUOTATION: 'Quotation',
  ORDER_CONFIRMATION: 'Order confirmation',
  INVOICE: 'Invoice',
  PURCHASE_ORDER: 'Purchase order',
};

/**
 * The document as a react-pdf element tree. A pure function of the snapshot and the logo bytes,
 * so rendering the same snapshot always produces the same content (Requirement 29.5).
 */
export function buildDocument(
  snapshot: DocumentSnapshot,
  options: RenderOptions = {},
): ReactElement<DocumentProps> {
  const language = snapshot.locale?.language ?? 'en';
  const money = (amount: string) => formatMoney(amount, snapshot.currency, language);
  const date = (iso: string) =>
    formatDate(iso, snapshot.locale?.dateFormat, snapshot.locale?.timezone);
  const title = snapshot.labels?.document ?? DEFAULT_LABELS[snapshot.type];
  const customerLabel = snapshot.labels?.customer ?? 'Customer';

  const party = snapshot.customer ?? snapshot.contact ?? null;
  const partyAddress = snapshot.customer ? formatAddress(snapshot.customer.address) : [];
  const business = snapshot.business;

  const header = view(
    styles.header,
    view(
      {},
      options.logo ? h(Image, { src: options.logo, style: styles.logo }) : null,
      text(styles.business, business.legalName),
      ...formatAddress(business.address).map((line) => text(null, line)),
      business.phone ? text(null, business.phone) : null,
      business.email ? text(null, business.email) : null,
      business.taxNumber ? text(styles.muted, `Tax no. ${business.taxNumber}`) : null,
    ),
    view(
      {},
      text(styles.title, title),
      text(styles.meta, `No. ${snapshot.number}`),
      text(styles.meta, `Date: ${date(snapshot.issuedAt)}`),
      snapshot.validUntil ? text(styles.meta, `Valid until: ${date(snapshot.validUntil)}`) : null,
      snapshot.expectedDate ? text(styles.meta, `Expected: ${date(snapshot.expectedDate)}`) : null,
      snapshot.orderNumber ? text(styles.meta, `Order: ${snapshot.orderNumber}`) : null,
    ),
  );

  const parties = view(
    styles.parties,
    view(
      styles.party,
      text(styles.label, customerLabel),
      party ? text({ fontWeight: 700 }, party.name) : text(styles.muted, '—'),
      ...partyAddress.map((line) => text(null, line)),
      party?.phone ? text(null, party.phone) : null,
      party?.email ? text(null, party.email) : null,
    ),
  );

  const head = view(
    styles.tableHead,
    text(styles.cNo, '#'),
    text(styles.cItem, 'Item'),
    text(styles.cQty, 'Qty'),
    text(styles.cPrice, snapshot.type === 'PURCHASE_ORDER' ? 'Unit cost' : 'Unit price'),
    text(styles.cDisc, 'Discount'),
    text(styles.cTotal, 'Total'),
  );

  const rows = snapshot.lines.map((line) =>
    h(
      View,
      { key: `line-${line.lineNo}`, style: styles.row, wrap: false },
      text(styles.cNo, String(line.lineNo)),
      view(
        styles.cItem,
        text({ fontWeight: 700 }, line.name),
        line.sku ? text(styles.field, line.sku) : null,
        line.description ? text(styles.field, line.description) : null,
        ...(Array.isArray(line.fieldSnapshot) ? line.fieldSnapshot : []).map(
          (f: { key: string; label: string; value: string; unit: string | null }) =>
            text(styles.field, `${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ''}`),
        ),
      ),
      text(styles.cQty, formatQuantity(line.quantity, language)),
      text(styles.cPrice, money(line.unitPrice)),
      text(styles.cDisc, Number(line.discountAmount) > 0 ? money(line.discountAmount) : '—'),
      text(styles.cTotal, money(line.lineTotal)),
    ),
  );

  const totalRow = (label: string, value: string, key: string) =>
    h(View, { key, style: styles.totalRow }, text(null, label), text(null, value));
  const totals = snapshot.totals;
  const totalRows: ReactElement[] = [totalRow('Subtotal', money(totals.subtotal), 'subtotal')];
  if (Number(totals.discountAmount) > 0) {
    const label =
      snapshot.discount.type === 'PERCENT'
        ? `Discount (${formatPercent(snapshot.discount.value, language)})`
        : 'Discount';
    totalRows.push(totalRow(label, `-${money(totals.discountAmount)}`, 'discount'));
  }
  for (const tax of snapshot.taxBreakdown ?? []) {
    totalRows.push(
      totalRow(
        `Tax ${formatPercent(tax.rate, language)}${snapshot.pricesIncludeTax ? ' (included)' : ''}`,
        money(tax.tax),
        `tax-${tax.rate}`,
      ),
    );
  }
  if ((snapshot.taxBreakdown ?? []).length === 0 && Number(totals.taxAmount) > 0) {
    totalRows.push(totalRow('Tax', money(totals.taxAmount), 'tax'));
  }
  if (totals.roundingAmount && Number(totals.roundingAmount) !== 0) {
    totalRows.push(totalRow('Rounding', money(totals.roundingAmount), 'rounding'));
  }
  const grand = h(
    View,
    { key: 'total', style: styles.grand },
    text(null, 'Total'),
    text(null, money(totals.totalAmount)),
  );
  const totalsBlock = view(styles.totals, ...totalRows, grand);

  const paymentsBlock =
    snapshot.type === 'INVOICE' && snapshot.paidAmount !== undefined
      ? view(
          styles.totals,
          ...(snapshot.payments ?? []).map((p, i) =>
            totalRow(`Paid ${date(p.date)} · ${p.method}`, money(p.amount), `pay-${i}`),
          ),
          totalRow('Total paid', money(snapshot.paidAmount), 'paid'),
          totalRow('Balance due', money(snapshot.balanceDue ?? '0'), 'balance'),
        )
      : null;

  const bank = bankLines(snapshot.bankDetails);
  const sections = [
    snapshot.notes
      ? view(styles.section, text(styles.sectionTitle, 'Notes'), text(null, snapshot.notes))
      : null,
    snapshot.terms
      ? view(styles.section, text(styles.sectionTitle, 'Terms'), text(null, snapshot.terms))
      : null,
    bank.length > 0
      ? view(
          styles.section,
          text(styles.sectionTitle, 'Bank details'),
          ...bank.map((line) => text(null, line)),
        )
      : null,
  ];

  const footer = h(
    View,
    { style: styles.footer, fixed: true },
    text(null, `${title} ${snapshot.number}`),
    h(Text, {
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages: number }) =>
        `Page ${pageNumber} of ${totalPages}`,
    }),
  );

  return h(
    Document,
    { title: `${title} ${snapshot.number}`, author: business.legalName, producer: 'Universal BMS' },
    h(
      Page,
      { size: 'A4', style: styles.page },
      header,
      parties,
      head,
      ...rows,
      totalsBlock,
      paymentsBlock,
      ...sections,
      footer,
    ),
  );
}

function bankLines(details: unknown): string[] {
  if (!details) return [];
  if (typeof details === 'string') return details.split('\n').filter(Boolean);
  if (Array.isArray(details)) return details.flatMap(bankLines);
  if (typeof details === 'object') {
    return Object.entries(details as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string' && v)
      .map(([k, v]) => `${k}: ${v as string}`);
  }
  return [];
}

/** All the text in an element tree, in reading order. Used to compare documents without parsing a PDF. */
export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  const element = node as ReactElement<{ children?: ReactNode; render?: unknown }>;
  const rendered =
    typeof element.props?.render === 'function'
      ? (element.props.render as (p: { pageNumber: number; totalPages: number }) => string)({
          pageNumber: 1,
          totalPages: 1,
        })
      : '';
  return `${rendered} ${textOf(element.props?.children)}`.trim();
}
