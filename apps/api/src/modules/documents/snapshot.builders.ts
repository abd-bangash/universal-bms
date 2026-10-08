import type { Customer, Order, OrderItem } from '@prisma/client';
import { D } from '../../common/money';
import type { LineDto } from '../sales/quotation.support';
import type {
  DocumentKind,
  DocumentPayment,
  DocumentSnapshot,
  TaxBreakdownRow,
} from './document.types';
import type { SnapshotSettings } from './snapshot-settings';

const DEFAULT_WORDS: Record<DocumentKind, string> = {
  QUOTATION: 'Quotation',
  ORDER_CONFIRMATION: 'Order confirmation',
  INVOICE: 'Invoice',
  PURCHASE_ORDER: 'Purchase order',
};

/** The common parts of every snapshot that come from the workspace settings. */
export function settingsPart(
  settings: SnapshotSettings,
  kind: DocumentKind,
): Pick<DocumentSnapshot, 'business' | 'currency' | 'locale' | 'labels' | 'pricesIncludeTax'> {
  const term = (key: 'quotation' | 'order' | 'customer' | 'supplier' | 'purchaseOrder') =>
    settings.terminology[key]?.singular;
  const document =
    kind === 'QUOTATION'
      ? (term('quotation') ?? DEFAULT_WORDS.QUOTATION)
      : kind === 'ORDER_CONFIRMATION'
        ? `${term('order') ?? 'Order'} confirmation`
        : kind === 'PURCHASE_ORDER'
          ? (term('purchaseOrder') ?? DEFAULT_WORDS.PURCHASE_ORDER)
          : DEFAULT_WORDS.INVOICE;
  return {
    business: { ...settings.business, logoFileId: settings.branding.logoFileId },
    currency: { code: settings.locale.currency, decimals: settings.locale.currencyDecimals },
    locale: {
      language: settings.locale.language,
      dateFormat: settings.locale.dateFormat,
      timezone: settings.locale.timezone,
    },
    labels: {
      document,
      customer:
        kind === 'PURCHASE_ORDER'
          ? (term('supplier') ?? 'Supplier')
          : (term('customer') ?? 'Customer'),
    },
    pricesIncludeTax: settings.pricesIncludeTax,
  };
}

/** Tax per rate: what the tax was charged on and how much it was, rates shown as percentages. */
export function taxBreakdown(lines: LineDto[]): TaxBreakdownRow[] {
  const byRate = new Map<string, { taxable: ReturnType<typeof D>; tax: ReturnType<typeof D> }>();
  for (const line of lines) {
    if (D(line.taxAmount).isZero() && D(line.taxRate).isZero()) continue;
    const rate = D(line.taxRate).mul(100).toDecimalPlaces(4).toFixed();
    const row = byRate.get(rate) ?? { taxable: D(0), tax: D(0) };
    row.taxable = row.taxable.plus(D(line.lineTotal).minus(line.taxAmount));
    row.tax = row.tax.plus(line.taxAmount);
    byRate.set(rate, row);
  }
  return [...byRate.entries()]
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([rate, v]) => ({ rate, taxable: v.taxable.toFixed(), tax: v.tax.toFixed() }));
}

export function orderLineDto(i: OrderItem): LineDto {
  return {
    id: i.id,
    lineNo: i.lineNo,
    kind: i.kind,
    productId: i.productId,
    variantId: i.variantId,
    name: i.name,
    sku: i.sku,
    description: i.description,
    quantity: i.quantity.toFixed(),
    unitId: i.unitId,
    listPrice: i.listPrice.toFixed(),
    unitPrice: i.unitPrice.toFixed(),
    discountType: i.discountType,
    discountValue: i.discountValue.toFixed(),
    discountAmount: i.discountAmount.toFixed(),
    taxClassId: i.taxClassId,
    taxRate: i.taxRate.toFixed(),
    taxAmount: i.taxAmount.toFixed(),
    lineTotal: i.lineTotal.toFixed(),
    customFields: i.customFields as Record<string, unknown>,
    fieldSnapshot: i.fieldSnapshot,
  };
}

export function buildOrderSnapshot(input: {
  kind: 'ORDER_CONFIRMATION' | 'INVOICE';
  number: string;
  at: Date;
  order: Order;
  items: OrderItem[];
  customer: Customer;
  settings: SnapshotSettings;
  payments?: DocumentPayment[];
}): DocumentSnapshot {
  const { order, customer, settings } = input;
  const lines = [...input.items].sort((a, b) => a.lineNo - b.lineNo).map(orderLineDto);
  const invoice = input.kind === 'INVOICE';
  return {
    type: input.kind,
    number: input.number,
    issuedAt: input.at.toISOString(),
    ...settingsPart(settings, input.kind),
    orderNumber: order.orderNumber,
    customer: {
      name: customer.fullName,
      phone: customer.phones[0] ?? null,
      email: customer.email,
      address: order.deliveryAddress ?? customer.billingAddress,
    },
    lines,
    totals: {
      subtotal: order.subtotal.toFixed(),
      discountAmount: order.discountAmount.toFixed(),
      taxAmount: order.taxAmount.toFixed(),
      roundingAmount: order.roundingAmount.toFixed(),
      totalAmount: order.totalAmount.toFixed(),
    },
    discount: { type: order.discountType, value: order.discountValue.toFixed() },
    taxBreakdown: taxBreakdown(lines),
    ...(invoice
      ? {
          payments: input.payments ?? [],
          paidAmount: D(order.paidAmount.toFixed()).minus(order.refundedAmount.toFixed()).toFixed(),
          balanceDue: order.balanceDue.toFixed(),
        }
      : {}),
    notes: order.notes,
    terms: invoice ? (settings.invoiceTerms ?? null) : (settings.quotationTerms ?? null),
    bankDetails: settings.showBankDetails ? settings.bankDetails : null,
  };
}
