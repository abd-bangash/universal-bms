import { Injectable } from '@nestjs/common';
import {
  calculateDocument,
  effectiveDiscountPercent,
  PricingError,
  type PricingLineResult,
  type PricingResult,
} from '@bms/calc';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import { D } from '../../common/money';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { DiscountDto, LineInputDto } from './pricing.dto';

export interface PricedLine {
  lineNo: number;
  kind: 'CATALOG' | 'CUSTOM';
  productId: string | null;
  variantId: string | null;
  name: string;
  sku: string | null;
  description: string | null;
  quantity: string;
  unitId: string | null;
  /** The price before any override. */
  listPrice: string;
  unitPrice: string;
  discountType: string | null;
  discountValue: string;
  taxClassId: string | null;
  taxRate: string;
  stockTracked: boolean;
  customFields: Record<string, unknown>;
  notes: string | null;
  calc: PricingLineResult;
}

export interface PriceOverride {
  lineNo: number;
  variantId: string | null;
  original: string;
  price: string;
}

export interface PricedDocument {
  lines: PricedLine[];
  calc: PricingResult;
  orderDiscount: { type: string; value: string } | null;
  /** Manual price changes; the caller records them in the audit log inside its own transaction. */
  overrides: PriceOverride[];
  settings: { currencyDecimals: number; pricesIncludeTax: boolean; taxEnabled: boolean };
}

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The list price of a variant for a customer (Requirement 35.1). Release 1 has the last two
   * steps of the chain: the variant's price override, then the product's base price. Price lists
   * (customer list, workspace default list) arrive in Release 3 and slot in above these.
   */
  async resolveUnitPrice(variantId: string, customerId?: string | null): Promise<string> {
    void customerId; // used once customer price lists exist (Release 3)
    const variant = await this.prisma.scoped.productVariant.findFirst({
      where: { id: variantId },
      include: { product: true },
    });
    if (!variant) throw new NotFoundAppException('A product variant does not exist');
    return (variant.priceOverride ?? variant.product.basePrice).toFixed();
  }

  /** The highest discount any of the user's Roles allows, as a percentage. */
  async maxDiscountPercent(user: AuthUser): Promise<string> {
    const rows = await this.prisma.scoped.userWorkspaceRole.findMany({
      where: { userWorkspaceId: user.membershipId },
      include: { role: { select: { maxDiscountPercent: true } } },
    });
    return rows.reduce((max, r) => D.max(max, r.role.maxDiscountPercent.toFixed()), D(0)).toFixed();
  }

  /**
   * Prices a set of lines: resolves catalog prices and tax, applies manual overrides (with the
   * permission check), runs the shared calculation and checks the discount limit.
   */
  async price(
    user: AuthUser,
    input: {
      lines: readonly LineInputDto[];
      orderDiscount?: DiscountDto | null;
      customerId?: string | null;
      cash?: boolean;
    },
  ): Promise<PricedDocument> {
    const config = await this.config();
    const overrides: PriceOverride[] = [];
    const errors: Record<string, string[]> = {};
    const lines: PricedLine[] = [];

    for (const [index, raw] of input.lines.entries()) {
      const field = `lines[${index}]`;
      const kind = raw.kind ?? (raw.variantId ? 'CATALOG' : 'CUSTOM');
      if (kind === 'CATALOG') {
        if (!raw.variantId) {
          errors[`${field}.variantId`] = ['is required for a catalog line'];
          continue;
        }
        const variant = await this.prisma.scoped.productVariant.findFirst({
          where: { id: raw.variantId },
          include: { product: true },
        });
        if (!variant) {
          errors[`${field}.variantId`] = ['does not exist'];
          continue;
        }
        if (variant.status === 'ARCHIVED' || variant.product.status === 'ARCHIVED') {
          throw new AppException('PRODUCT_ARCHIVED', 422, 'An archived product cannot be added', {
            [`${field}.variantId`]: ['is archived'],
          });
        }
        const listPrice = await this.resolveUnitPrice(variant.id, input.customerId);
        let unitPrice = listPrice;
        if (raw.unitPrice !== undefined && !D(raw.unitPrice).eq(listPrice)) {
          if (!user.permissions.includes('order:price_override')) {
            throw new AppException('PERMISSION_DENIED', 403, 'You may not change prices', {
              [`${field}.unitPrice`]: ['changing the price needs the price override permission'],
            });
          }
          unitPrice = raw.unitPrice;
          overrides.push({
            lineNo: index + 1,
            variantId: variant.id,
            original: listPrice,
            price: unitPrice,
          });
        }
        const taxClassId = variant.product.taxClassId ?? config.defaultTaxClassId ?? null;
        lines.push({
          lineNo: index + 1,
          kind: 'CATALOG',
          productId: variant.productId,
          variantId: variant.id,
          name: variant.name ? `${variant.product.name} — ${variant.name}` : variant.product.name,
          sku: variant.sku,
          description: raw.description ?? null,
          quantity: raw.quantity,
          unitId: raw.unitId ?? variant.product.saleUnitId ?? variant.product.baseUnitId,
          listPrice,
          unitPrice,
          discountType: raw.discount?.type ?? null,
          discountValue: raw.discount?.value ?? '0',
          taxClassId,
          taxRate: await this.taxRate(config, taxClassId),
          stockTracked: variant.product.type === 'STOCKABLE' && !variant.product.madeToOrder,
          customFields: raw.customFields ?? {},
          notes: raw.notes ?? null,
          calc: undefined as never,
        });
      } else {
        if (!raw.name?.trim()) errors[`${field}.name`] = ['is required for a custom line'];
        if (raw.unitPrice === undefined)
          errors[`${field}.unitPrice`] = ['is required for a custom line'];
        if (raw.variantId) errors[`${field}.variantId`] = ['a custom line has no catalog variant'];
        if (errors[`${field}.name`] || errors[`${field}.unitPrice`] || errors[`${field}.variantId`])
          continue;
        const taxClassId = raw.taxClassId ?? config.defaultTaxClassId ?? null;
        lines.push({
          lineNo: index + 1,
          kind: 'CUSTOM',
          productId: null,
          variantId: null,
          name: (raw.name as string).trim(),
          sku: null,
          description: raw.description ?? null,
          quantity: raw.quantity,
          unitId: raw.unitId ?? null,
          listPrice: raw.unitPrice as string,
          unitPrice: raw.unitPrice as string,
          discountType: raw.discount?.type ?? null,
          discountValue: raw.discount?.value ?? '0',
          taxClassId,
          taxRate: await this.taxRate(config, taxClassId),
          stockTracked: false,
          customFields: raw.customFields ?? {},
          notes: raw.notes ?? null,
          calc: undefined as never,
        });
      }
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);

    let calc: PricingResult;
    try {
      calc = calculateDocument({
        lines: lines.map((l) => ({
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          discount: l.discountType
            ? { type: l.discountType as 'AMOUNT' | 'PERCENT', value: l.discountValue }
            : null,
          taxRate: l.taxRate,
        })),
        orderDiscount: input.orderDiscount ?? null,
        pricesIncludeTax: config.pricesIncludeTax,
        currencyDecimals: config.currencyDecimals,
        cashRoundingIncrement: input.cash ? config.cashRoundingIncrement : null,
      });
    } catch (err) {
      if (err instanceof PricingError)
        throw new ValidationFailedException({ [err.field]: [err.message] });
      throw err;
    }
    lines.forEach((line, i) => (line.calc = calc.lines[i] as PricingLineResult));
    await this.assertDiscountWithinLimit(user, lines);

    return {
      lines,
      calc,
      orderDiscount: input.orderDiscount ?? null,
      overrides,
      settings: {
        currencyDecimals: config.currencyDecimals,
        pricesIncludeTax: config.pricesIncludeTax,
        taxEnabled: config.taxEnabled,
      },
    };
  }

  /**
   * A line's effective discount (its own plus its share of the order discount) may not exceed the
   * highest limit among the user's Roles (Requirement 35.4). Release 1 rejects; approval requests
   * for `sales.discountOverLimit = APPROVAL` arrive with task 97.
   */
  async assertDiscountWithinLimit(user: AuthUser, lines: readonly PricedLine[]): Promise<void> {
    const limit = await this.maxDiscountPercent(user);
    const over = lines.filter((l) => D(effectiveDiscountPercent(l.calc)).gt(limit));
    if (over.length > 0) {
      throw new AppException(
        'DISCOUNT_OVER_LIMIT',
        422,
        `Your discount limit is ${limit}%`,
        Object.fromEntries(
          over.map((l) => [
            `lines[${l.lineNo - 1}].discount`,
            [`${effectiveDiscountPercent(l.calc)}% is over your limit of ${limit}%`],
          ]),
        ),
      );
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────

  private async config() {
    const [taxEnabled, pricesIncludeTax, defaultTaxClassId, currencyDecimals, cashRounding] =
      await Promise.all([
        this.settings.get<boolean>('tax.enabled'),
        this.settings.get<boolean>('tax.pricesIncludeTax'),
        this.settings.get<string | undefined>('tax.defaultTaxClassId'),
        this.settings.get<number>('locale.currencyDecimals'),
        this.settings.get<number | null>('sales.cashRoundingIncrement'),
      ]);
    return {
      taxEnabled,
      pricesIncludeTax,
      defaultTaxClassId: defaultTaxClassId ?? undefined,
      currencyDecimals,
      cashRoundingIncrement:
        cashRounding === null || cashRounding === undefined ? null : String(cashRounding),
    };
  }

  /** "0" when tax is off, otherwise the rate of the line's tax class. */
  private async taxRate(
    config: { taxEnabled: boolean },
    taxClassId: string | null,
  ): Promise<string> {
    if (!config.taxEnabled || !taxClassId) return '0';
    const tax = await this.prisma.scoped.taxClass.findFirst({ where: { id: taxClassId } });
    return tax ? tax.rate.toFixed() : '0';
  }
}
