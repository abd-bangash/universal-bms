import sharp from 'sharp';
import { FilesService } from '../../modules/files/files.service';
import { ProductImagesService } from '../../modules/catalog/product-images.service';
import { ProductsService } from '../../modules/catalog/products.service';
import type { DemoContext, DemoStep, StepResult } from '../demo-seed';
import { DEMO_PRODUCTS, type DemoProduct } from './catalog.data';

const PALETTE = ['#8d6e63', '#6d8299', '#9aa68c', '#b08968', '#7c7f93', '#a38f85', '#789a8b'];
const COLOR_LABEL: Record<string, string> = {
  brown: 'Brown',
  black: 'Black',
  grey: 'Grey',
  beige: 'Beige',
  white: 'White',
  blue: 'Blue',
  green: 'Green',
};

/** A labelled placeholder picture (no real photographs ship with the demo data). */
export function placeholderImage(name: string, index: number): Promise<Buffer> {
  const background = PALETTE[index % PALETTE.length] as string;
  const label = name.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
    <rect width="800" height="600" fill="${background}"/>
    <rect x="40" y="40" width="720" height="520" fill="none" stroke="#ffffff" stroke-opacity="0.6" stroke-width="4"/>
    <text x="400" y="310" font-family="sans-serif" font-size="40" fill="#ffffff" text-anchor="middle">${label}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * 30 furniture products over the profile's categories, with dimensions, material and finish
 * attributes, aliases, colour variants, barcodes, stock limits and a placeholder image each.
 * Everything goes through the real catalog services, so the data obeys every rule the API does.
 */
export const catalogStep: DemoStep = {
  name: 'catalog',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const products = ctx.get(ProductsService);
    const images = ctx.get(ProductImagesService);
    const files = ctx.get(FilesService);

    const categories = await unscoped.category.findMany({
      where: { workspaceId: ctx.workspaceId },
    });
    const unit = await unscoped.unit.findFirst({
      where: { workspaceId: ctx.workspaceId, symbol: 'pc' },
    });
    const have = new Set(
      (
        await unscoped.product.findMany({
          where: { workspaceId: ctx.workspaceId },
          select: { code: true },
        })
      ).map((p) => p.code),
    );
    let created = 0;
    let existing = 0;
    let barcode = 8_960_000_000_000;

    for (const [index, item] of DEMO_PRODUCTS.entries()) {
      const baseBarcode = barcode;
      barcode += 10;
      if (have.has(item.code)) {
        existing += 1;
        continue;
      }
      const category = categories.find((c) => c.name === item.category && c.parentId !== null);
      if (!category) throw new Error(`The demo catalog needs the category "${item.category}"`);

      await ctx.asOwner(async (owner) => {
        const product = await products.create(owner, {
          code: item.code,
          name: item.name,
          description: describe(item),
          categoryId: category.id,
          type: 'STOCKABLE',
          madeToOrder: item.madeToOrder ?? false,
          baseUnitId: unit?.id,
          saleUnitId: unit?.id,
          basePrice: item.price,
          costPrice: item.cost,
          tags: item.tags ?? [],
          aliases: item.aliases,
          customFields: attributes(item),
          variants: variantsOf(item, baseBarcode),
        });
        const png = await placeholderImage(item.name, index);
        const file = await files.upload(
          owner,
          { buffer: png, originalname: `${item.code.toLowerCase()}.png`, size: png.length },
          { entityType: 'PRODUCT', entityId: product.id, purpose: 'image' },
        );
        await images.attach(owner, product.id, { fileId: file.id, isPrimary: true });
      });
      created += 1;
    }
    return { created, existing };
  },
};

const describe = (item: DemoProduct): string =>
  `${item.name}: ${item.material} with a ${item.finish} finish, ${item.size[0]} × ${item.size[1]} × ${item.size[2]} cm.`;

function attributes(item: DemoProduct): Record<string, unknown> {
  const [width, depth, height] = item.size;
  return {
    width: { value: String(width), unit: 'cm' },
    depth: { value: String(depth), unit: 'cm' },
    height: { value: String(height), unit: 'cm' },
    material: item.material,
    finish: item.finish,
    color: item.color,
  };
}

function variantsOf(item: DemoProduct, baseBarcode: number) {
  const colors = item.variantColors;
  if (!colors || colors.length === 0) {
    return [{ sku: item.code, barcode: String(baseBarcode), minStockLevel: item.minStock }];
  }
  return colors.map((color, i) => ({
    sku: `${item.code}-${color}`,
    barcode: String(baseBarcode + i + 1),
    name: COLOR_LABEL[color],
    minStockLevel: item.minStock,
    customFields: {
      color,
      material:
        item.material === 'wood' || item.material === 'leather' || item.material === 'fabric'
          ? item.material
          : undefined,
    },
  }));
}
