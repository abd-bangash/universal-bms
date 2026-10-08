import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import type { ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FieldsService } from '../fields/fields.service';
import type { PricedDocument } from '../pricing/pricing.service';
import type { DocumentTotals, LineRow } from './line-rows';

export type LineEntity = 'QUOTATION_ITEM' | 'ORDER_ITEM';

/** What quotations and orders share: turning priced lines into stored rows, and the totals. */
@Injectable()
export class DocumentLinesService {
  constructor(
    private readonly fields: FieldsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Validates each line's custom fields against the definitions for that kind of line and freezes
   * their labels and values on the line, so later changes to a definition do not alter the
   * document (Requirement 26.8).
   */
  async rows(entity: LineEntity, priced: PricedDocument): Promise<LineRow[]> {
    const rows: LineRow[] = [];
    for (const line of priced.lines) {
      const customFields = await this.fields
        .validate(entity, line.customFields, {
          categoryId: line.categoryId,
          productType: line.productType,
        })
        .catch((err: { details?: Record<string, string[]> }) => {
          // report the problem against the line it belongs to
          if (err.details) {
            for (const key of Object.keys(err.details)) {
              err.details[`lines[${line.lineNo - 1}].${key}`] = err.details[key] as string[];
              delete err.details[key];
            }
          }
          throw err;
        });
      rows.push({
        lineNo: line.lineNo,
        kind: line.kind,
        productId: line.productId,
        variantId: line.variantId,
        name: line.name,
        sku: line.sku,
        description: line.description,
        quantity: line.quantity,
        unitId: line.unitId,
        listPrice: line.listPrice,
        unitPrice: line.unitPrice,
        discountType: line.discountType,
        discountValue: line.discountValue,
        discountAmount: line.calc.discountAmount,
        taxClassId: line.taxClassId,
        taxRate: line.taxRate,
        taxAmount: line.calc.taxAmount,
        lineTotal: line.calc.lineTotal,
        customFields,
        fieldSnapshot: await this.fields.snapshot(entity, customFields),
        stockTracked: line.stockTracked,
        notes: line.notes,
      });
    }
    return rows;
  }

  totals(priced: PricedDocument): DocumentTotals {
    return {
      subtotal: priced.calc.subtotal,
      discountAmount: priced.calc.discountAmount,
      taxAmount: priced.calc.taxAmount,
      roundingAmount: priced.calc.roundingAmount,
      totalAmount: priced.calc.total,
    };
  }

  /** Every manual price change leaves the original and the new price in the audit log (Requirement 35.9). */
  async auditOverrides(
    tx: ScopedTransaction,
    user: AuthUser,
    entityType: 'Quotation' | 'Order',
    entityId: string,
    priced: PricedDocument,
  ): Promise<void> {
    for (const override of priced.overrides) {
      await this.audit.record(tx, {
        action: 'price.override',
        entityType,
        entityId,
        before: { unitPrice: override.original },
        after: { unitPrice: override.price },
        metadata: { lineNo: override.lineNo, variantId: override.variantId, userId: user.userId },
      });
    }
  }
}
