import { D } from '../../common/money';
import { PurchasesService } from '../../modules/purchasing/purchases.service';
import { SuppliersService } from '../../modules/purchasing/suppliers.service';
import type { DemoContext, DemoStep, StepResult } from '../demo-seed';

export const DEMO_SUPPLIERS = [
  { name: 'Timber & Wood Traders', contactName: 'Tariq Mehmood', phone: '0300-1112233' },
  { name: 'Foam Industries', contactName: 'Farah Siddiqui', phone: '0321-4445566' },
  { name: 'Fabric House', contactName: 'Faisal Anwar', phone: '0333-7778899' },
  { name: 'Hardware Hub', contactName: 'Hamid Raza', phone: '0301-2223344' },
  { name: 'Packaging Plus', contactName: 'Pervez Ali', phone: '0345-6667788' },
] as const;

/**
 * Five suppliers and five purchases in different states: two received on the spot (quick
 * purchases), one partly received, one sent and one still a draft (Requirement 50.2). Goes through
 * the same services as the API, so stock and costs follow the real rules.
 */
export const purchasingStep: DemoStep = {
  name: 'purchasing',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const existingSuppliers = await unscoped.supplier.count({
      where: { workspaceId: ctx.workspaceId },
    });
    const existingPurchases = await unscoped.purchaseOrder.count({
      where: { workspaceId: ctx.workspaceId },
    });
    if (existingSuppliers > 0 || existingPurchases > 0) {
      return { created: 0, existing: existingSuppliers + existingPurchases };
    }
    const variants = await unscoped.productVariant.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        status: 'ACTIVE',
        product: { type: 'STOCKABLE', madeToOrder: false },
      },
      include: { product: true },
      orderBy: { sku: 'asc' },
      take: 15,
    });
    if (variants.length < 8) return { created: 0, existing: 0 };
    const cost = (v: (typeof variants)[number]) =>
      D((v.priceOverride ?? v.product.basePrice).toFixed())
        .mul('0.6')
        .toDecimalPlaces(2)
        .toFixed();
    const lines = (from: number, to: number, quantity: string) =>
      variants.slice(from, to).map((v) => ({ variantId: v.id, quantity, unitCost: cost(v) }));

    const suppliers = ctx.get(SuppliersService);
    const purchases = ctx.get(PurchasesService);
    let created = 0;
    await ctx.asOwner(async (owner) => {
      const made = [];
      for (const s of DEMO_SUPPLIERS) {
        made.push(await suppliers.create(owner, s));
        created += 1;
      }
      const [timber, foam, fabric, hardware, packaging] = made;
      if (!timber || !foam || !fabric || !hardware || !packaging) return;

      // two purchases that arrived straight away
      await purchases.quick(owner, {
        supplierId: timber.id,
        lines: lines(0, 3, '20'),
        notes: 'Quarterly timber order',
      });
      await purchases.quick(owner, { supplierId: foam.id, lines: lines(3, 5, '30') });
      created += 2;

      // one sent and partly received
      const partly = await purchases.create(owner, {
        supplierId: fabric.id,
        lines: lines(5, 7, '30'),
        expectedDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      await purchases.changeStatus(owner, partly.id, { status: 'sent' });
      const first = partly.items?.[0];
      if (first) {
        await purchases.receive(owner, partly.id, {
          lines: [{ itemId: first.id, quantity: '10' }],
        });
      }

      // one sent, one draft
      const sent = await purchases.create(owner, {
        supplierId: hardware.id,
        lines: lines(7, 8, '50'),
      });
      await purchases.changeStatus(owner, sent.id, { status: 'sent' });
      await purchases.create(owner, {
        supplierId: packaging.id,
        lines: lines(8, 10, '100'),
        notes: 'Waiting for the quote',
      });
      created += 3;
    });
    return { created, existing: 0 };
  },
};
