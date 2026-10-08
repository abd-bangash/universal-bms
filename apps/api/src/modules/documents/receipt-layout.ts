import { createElement as h, type ReactElement, type ReactNode } from 'react';
import type { DocumentProps, Styles } from '@react-pdf/renderer';
import type { ReceiptData, ReceiptPaper, ReceiptRenderOptions } from './document.types';
import { formatAddress, formatDate, formatMoney, formatPercent, formatQuantity } from './format';

// String tags, as in document-layout.ts: no import of the ESM-only library here.
const Document = 'DOCUMENT';
const Page = 'PAGE';
const View = 'VIEW';
const Text = 'TEXT';
const Image = 'IMAGE';

const MM = 72 / 25.4;

interface PaperSpec {
  width: number;
  /** Page height is estimated from the content for thermal rolls; A4 is a fixed sheet. */
  thermal: boolean;
  padding: number;
  font: number;
}

export const PAPERS: Record<ReceiptPaper, PaperSpec> = {
  '58mm': { width: Math.round(58 * MM), thermal: true, padding: 6, font: 7 },
  '80mm': { width: Math.round(80 * MM), thermal: true, padding: 8, font: 8 },
  A4: { width: 595, thermal: false, padding: 40, font: 10 },
};

type Style = Styles[string];
const view = (style: Style, ...children: ReactNode[]) => h(View, { style }, ...children);
const text = (style: Style | null, ...children: ReactNode[]) =>
  h(Text, { style: style ?? undefined }, ...children);

/**
 * The sale receipt as a react-pdf tree, a pure function of the stored receipt data, so a reprint
 * draws exactly what the first copy did (Requirements 12.5, 12.6, 23.1, 29.8).
 */
export function buildReceipt(
  data: ReceiptData,
  options: ReceiptRenderOptions,
): ReactElement<DocumentProps> {
  const paper = PAPERS[options.paper];
  const language = data.locale?.language ?? 'en';
  const money = (amount: string) => formatMoney(amount, data.currency, language);
  const business = data.business;
  const narrow = options.paper === '58mm';
  const wide = options.paper === 'A4';

  const s: Record<string, Style> = {
    page: { padding: paper.padding, fontSize: paper.font, fontFamily: 'Helvetica', color: '#000' },
    center: { textAlign: 'center' },
    name: { fontSize: paper.font + 3, fontWeight: 700, textAlign: 'center', marginBottom: 2 },
    reprint: {
      fontSize: paper.font + 3,
      fontWeight: 700,
      textAlign: 'center',
      borderWidth: 1,
      borderColor: '#000',
      paddingVertical: 2,
      marginBottom: 4,
    },
    rule: { borderBottomWidth: 0.5, borderBottomColor: '#000', marginVertical: 4 },
    row: { flexDirection: 'row', justifyContent: 'space-between' },
    line: { marginBottom: 3 },
    lineName: { fontWeight: 700 },
    muted: { color: '#444' },
    grand: { flexDirection: 'row', justifyContent: 'space-between', fontWeight: 700 },
    logo: {
      width: wide ? 120 : 60,
      height: wide ? 60 : 30,
      objectFit: 'contain',
      alignSelf: 'center',
    },
  };
  const pair = (label: string, value: string, key: string, style?: Style) =>
    h(View, { key, style: style ?? s.row }, text(null, label), text(null, value));

  const header = view(
    {},
    options.reprint ? text(s.reprint, '*** REPRINT ***') : null,
    options.logo ? h(Image, { src: options.logo, style: s.logo }) : null,
    text(s.name, business.legalName),
    ...formatAddress(business.address).map((l) => text(s.center, l)),
    business.phone ? text(s.center, business.phone) : null,
    business.email ? text(s.center, business.email) : null,
    business.taxNumber ? text(s.center, `Tax no. ${business.taxNumber}`) : null,
  );

  const meta = view(
    {},
    pair('Receipt', options.receiptNumber, 'no'),
    pair('Transaction', data.transactionNumber, 'tx'),
    pair('Date', formatDate(data.issuedAt, data.locale?.dateFormat, data.locale?.timezone), 'date'),
    data.cashier ? pair('Cashier', data.cashier, 'cashier') : null,
    data.customer ? pair('Customer', data.customer.name, 'customer') : null,
  );

  const items = data.lines.map((line) =>
    h(
      View,
      { key: `line-${line.lineNo}`, style: s.line, wrap: false },
      text(s.lineName, line.name),
      h(
        View,
        { style: s.row },
        text(s.muted, `${formatQuantity(line.quantity, language)} × ${money(line.unitPrice)}`),
        text(null, money(line.lineTotal)),
      ),
      Number(line.discountAmount) > 0
        ? text(s.muted, `Discount -${money(line.discountAmount)}`)
        : null,
    ),
  );

  const totals = data.totals;
  const rows: ReactElement[] = [pair('Subtotal', money(totals.subtotal), 'subtotal')];
  if (Number(totals.discountAmount) > 0) {
    const label =
      data.discount.type === 'PERCENT'
        ? `Discount (${formatPercent(data.discount.value, language)})`
        : 'Discount';
    rows.push(pair(label, `-${money(totals.discountAmount)}`, 'discount'));
  }
  for (const tax of data.taxBreakdown ?? []) {
    rows.push(pair(`Tax ${formatPercent(tax.rate, language)}`, money(tax.tax), `tax-${tax.rate}`));
  }
  if ((data.taxBreakdown ?? []).length === 0 && Number(totals.taxAmount) > 0) {
    rows.push(pair('Tax', money(totals.taxAmount), 'tax'));
  }
  if (totals.roundingAmount && Number(totals.roundingAmount) !== 0) {
    rows.push(pair('Rounding', money(totals.roundingAmount), 'rounding'));
  }
  rows.push(pair('Total', money(totals.totalAmount), 'total', s.grand));
  for (const [i, p] of data.payments.entries()) {
    rows.push(pair(p.method, money(p.amount), `pay-${i}`));
    if (p.reference) rows.push(pair('Ref.', p.reference, `ref-${i}`));
  }
  if (data.tendered !== undefined) rows.push(pair('Tendered', money(data.tendered), 'tendered'));
  if (data.changeDue !== undefined && Number(data.changeDue) > 0) {
    rows.push(pair('Change', money(data.changeDue), 'change'));
  }

  const body = [
    header,
    view(s.rule),
    meta,
    view(s.rule),
    ...items,
    view(s.rule),
    view({}, ...rows),
    data.footer ? view({ marginTop: 8 }, text(s.center, data.footer)) : null,
  ];

  // a thermal roll is as long as the sale: estimate the height from what is printed
  const height = paper.thermal
    ? Math.max(
        240,
        Math.round(
          160 +
            (narrow ? 12 : 10) * 6 +
            data.lines.length * (paper.font * 3.6) +
            rows.length * (paper.font * 1.6) +
            (data.footer ? 40 : 0) +
            (options.reprint ? 24 : 0),
        ),
      )
    : 842;
  const size = paper.thermal ? { width: paper.width, height } : 'A4';

  return h(
    Document,
    {
      title: `Receipt ${options.receiptNumber}`,
      author: business.legalName,
      producer: 'Universal BMS',
    },
    h(Page, { size, style: s.page }, ...body),
  );
}
