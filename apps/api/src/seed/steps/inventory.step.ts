import { D } from '../../common/money';
import { StockOperationsService } from '../../modules/inventory/stock-operations.service';
import type { DemoContext, DemoStep, StepResult } from '../demo-seed';

/**
 * Opening stock for every stockable variant at the default location, priced at 60 percent of the
 * selling price. Most variants are well stocked; a few are low and a few overstocked so the
 * stock table has something to flag (Requirements 7.5, 37.11).
 */
export const inventoryStep: DemoStep = {
  name: 'inventory',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const stock = ctx.get(StockOperationsService);

    const variants = await unscoped.productVariant.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: 'ACTIVE',
        product: { type: 'STOCKABLE', madeToOrder: false },
      },
      include: { product: true },
      orderBy: { sku: 'asc' },
    });
    const have = new Set(
      (
        await unscoped.stockMovement.findMany({
          where: { workspaceId: ctx.workspaceId, movementType: 'OPENING_STOCK' },
          select: { variantId: true },
        })
      ).map((m) => m.variantId),
    );
    const todo = variants.filter((v) => !have.has(v.id));
    if (todo.length === 0) return { created: 0, existing: variants.length };

    const lines = todo.map((v, i) => {
      const price = D((v.priceOverride ?? v.product.basePrice).toFixed());
      // every 7th variant is low, every 11th is overstocked, the rest hold 40
      const quantity = i % 7 === 3 ? '2' : i % 11 === 5 ? '90' : '40';
      return { variantId: v.id, quantity, unitCost: price.mul('0.6').toDecimalPlaces(2).toFixed() };
    });
    await ctx.asOwner(async (owner) => {
      await stock.openingStock(owner, { lines, note: 'Demo opening stock' });
    });
    // the levels the stock table flags
    for (const [i, v] of todo.entries()) {
      await unscoped.productVariant.update({
        where: { id: v.id },
        data: { minStockLevel: i % 7 === 3 ? '5' : '8', maxStockLevel: '80' },
      });
    }
    return { created: todo.length, existing: variants.length - todo.length };
  },
};
