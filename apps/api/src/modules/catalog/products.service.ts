import { Injectable } from '@nestjs/common';
import { Prisma, type Product, type ProductVariant } from '@prisma/client';
import { optionsOf } from '@bms/calc';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import {
  AppException,
  NotFoundAppException,
  ValidationFailedException,
} from '../../common/errors/app.exception';
import {
  keysetCursor,
  keysetWhere,
  parseSort,
  toPage,
  type Page,
} from '../../common/pagination/pagination';
import { PrismaService, type ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FieldsService } from '../fields/fields.service';
import { CategoriesService } from './categories.service';
import {
  PRODUCT_COLUMNS,
  cleanList,
  conflictFrom,
  nonNegative,
  requireDetails,
  toProductDto,
  toVariantDto,
  uniqueColumns,
  type ProductDto,
  type VariantDto,
} from './catalog.support';
import type {
  CreateProductDto,
  GenerateVariantsDto,
  ListProductsQuery,
  UpdateProductDto,
  UpdateVariantDto,
  VariantInputDto,
} from './dto/catalog.dto';

const INCLUDE = { variants: true, images: true } as const;
const SORTS = ['name', 'code', 'createdAt'] as const;
const NOT_STOCKED = new Set(['NON_STOCKABLE', 'SERVICE']);
const CODE_PREFIX = 'P-';
const MAX_VARIANTS_PER_GENERATION = 200;

type Tx = ScopedTransaction;
type ProductScalarData = Partial<
  Omit<
    Prisma.ProductUncheckedCreateInput,
    'workspaceId' | 'code' | 'name' | 'basePrice' | 'customFields'
  >
>;
type ProductRow = Product & { variants: ProductVariant[] };

const canViewCost = (user: AuthUser): boolean => user.permissions.includes('product:view_cost');
const audited = (dto: ProductDto): Record<string, unknown> =>
  dto as unknown as Record<string, unknown>;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: FieldsService,
    private readonly categories: CategoriesService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────────────────────

  async list(
    user: AuthUser,
    query: ListProductsQuery,
    raw: Record<string, unknown>,
  ): Promise<Page<ProductDto>> {
    const sort = parseSort(query.sort, SORTS, { field: 'name', direction: 'asc' });
    const filters: Prisma.ProductWhereInput[] = [];

    // Archived products stay out of normal lists; ask for them with status=ARCHIVED.
    filters.push(query.status ? { status: query.status } : { status: { not: 'ARCHIVED' } });
    if (query.brandId) filters.push({ brandId: query.brandId });
    if (query.type) filters.push({ type: query.type as Product['type'] });
    if (query.categoryId) {
      const ids = [query.categoryId, ...(await this.categories.descendantIds(query.categoryId))];
      filters.push({ categoryId: { in: ids } });
    }
    if (query.q?.trim()) {
      const text = { contains: query.q.trim(), mode: 'insensitive' as const };
      filters.push({
        OR: [
          { name: text },
          { code: text },
          { aliases: { has: query.q.trim() } },
          { variants: { some: { OR: [{ sku: text }, { barcode: text }] } } },
        ],
      });
    }
    const cfIds = await this.fields.matchingIds('products', 'PRODUCT', raw);
    if (cfIds) filters.push({ id: { in: cfIds } });
    const after = keysetWhere(sort.field, sort.direction, query.cursor, sort.field === 'createdAt');
    if (after) filters.push(after as Prisma.ProductWhereInput);

    const rows = await this.prisma.scoped.product.findMany({
      where: { AND: filters },
      include: INCLUDE,
      orderBy: [{ [sort.field]: sort.direction }, { id: sort.direction }],
      take: query.limit + 1,
    });
    return toPage(rows, query.limit, (last) =>
      keysetCursor(last[sort.field as 'name' | 'code' | 'createdAt'], last.id),
    ).map((p) => toProductDto(p, canViewCost(user)));
  }

  async get(user: AuthUser, id: string): Promise<ProductDto> {
    return toProductDto(await this.row(id), canViewCost(user));
  }

  // ── create ──────────────────────────────────────────────────────────────────────────────

  async create(user: AuthUser, dto: CreateProductDto): Promise<ProductDto> {
    const fields = await this.prepare(dto, undefined);
    const inputs: VariantInputDto[] = dto.variants?.length ? dto.variants : [{}];
    const explicit = new Set<string>();
    for (const v of inputs) {
      if (v.sku) {
        if (explicit.has(v.sku)) requireDetails({ variants: [`SKU ${v.sku} is repeated`] });
        explicit.add(v.sku);
      }
    }

    for (let attempt = 0; ; attempt++) {
      try {
        const created = await this.prisma.scoped.$transaction(async (tx) => {
          const code = dto.code?.trim() || (await this.nextCode(tx, user.workspaceId));
          const product = await tx.product.create({
            data: {
              ...fields.data,
              workspaceId: user.workspaceId,
              code,
              name: dto.name.trim(),
              basePrice: dto.basePrice,
              customFields: fields.customFields as Prisma.InputJsonValue,
            },
          });
          for (const [index, input] of inputs.entries()) {
            await this.createVariant(tx, user, product, input, {
              isDefault: index === 0,
              defaultSku: inputs.length === 1 ? code : `${code}-${index + 1}`,
              categoryPath: fields.categoryPath,
            });
          }
          const full = await tx.product.findFirstOrThrow({
            where: { id: product.id },
            include: INCLUDE,
          });
          await this.audit.record(tx, {
            action: 'product.create',
            entityType: 'Product',
            entityId: product.id,
            after: audited(toProductDto(full, true)),
          });
          return full;
        });
        return toProductDto(created, canViewCost(user));
      } catch (err) {
        // A generated code can collide with a concurrent create: pick the next one.
        if (!dto.code && attempt < 3 && uniqueColumns(err)?.includes('code')) continue;
        throw conflictFrom(err, PRODUCT_COLUMNS) ?? err;
      }
    }
  }

  // ── update ──────────────────────────────────────────────────────────────────────────────

  async update(user: AuthUser, id: string, dto: UpdateProductDto): Promise<ProductDto> {
    const existing = await this.row(id);
    if (existing.status === 'ARCHIVED' && dto.status === undefined) {
      throw new AppException(
        'PRODUCT_ARCHIVED',
        422,
        'An archived product cannot be edited; restore it first',
      );
    }
    if (
      dto.status !== undefined &&
      existing.status === 'ARCHIVED' &&
      !user.permissions.includes('product:archive')
    ) {
      throw new AppException('PERMISSION_DENIED', 403, 'You cannot restore archived products');
    }
    const fields = await this.prepare(dto, existing);

    try {
      const updated = await this.prisma.scoped.$transaction(async (tx) => {
        const result = await tx.product.updateMany({
          where: { id, version: dto.version },
          data: {
            ...fields.data,
            code: dto.code?.trim(),
            name: dto.name?.trim(),
            basePrice: dto.basePrice,
            ...(fields.customFields
              ? { customFields: fields.customFields as Prisma.InputJsonValue }
              : {}),
            version: { increment: 1 },
          },
        });
        if (result.count === 0) {
          throw new AppException(
            'STALE_VERSION',
            409,
            'This product was changed by someone else; reload and try again',
          );
        }
        if (dto.status === 'ACTIVE' && existing.status === 'ARCHIVED') {
          await tx.productVariant.updateMany({
            where: { productId: id },
            data: { status: 'ACTIVE' },
          });
        }
        const full = await tx.product.findFirstOrThrow({ where: { id }, include: INCLUDE });
        await this.audit.record(tx, {
          action: 'product.update',
          entityType: 'Product',
          entityId: id,
          before: audited(toProductDto(existing as never, true)),
          after: audited(toProductDto(full, true)),
        });
        return full;
      });
      return toProductDto(updated, canViewCost(user));
    } catch (err) {
      throw conflictFrom(err, PRODUCT_COLUMNS) ?? err;
    }
  }

  /** Archive keeps every historical record and blocks new documents (Requirement 6.7). */
  async archive(user: AuthUser, id: string, version?: number): Promise<ProductDto> {
    const existing = await this.row(id);
    if (existing.status === 'ARCHIVED') return toProductDto(existing, canViewCost(user));
    const archived = await this.prisma.scoped.$transaction(async (tx) => {
      const result = await tx.product.updateMany({
        where: { id, ...(version === undefined ? {} : { version }) },
        data: { status: 'ARCHIVED', version: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new AppException(
          'STALE_VERSION',
          409,
          'This product was changed by someone else; reload and try again',
        );
      }
      await tx.productVariant.updateMany({
        where: { productId: id },
        data: { status: 'ARCHIVED' },
      });
      const full = await tx.product.findFirstOrThrow({ where: { id }, include: INCLUDE });
      await this.audit.record(tx, {
        action: 'product.archive',
        entityType: 'Product',
        entityId: id,
        before: { status: existing.status },
        after: { status: 'ARCHIVED' },
      });
      return full;
    });
    return toProductDto(archived, canViewCost(user));
  }

  // ── variants ────────────────────────────────────────────────────────────────────────────

  async addVariant(user: AuthUser, productId: string, input: VariantInputDto): Promise<VariantDto> {
    const product = await this.row(productId);
    if (product.status === 'ARCHIVED') throw archivedError();
    const categoryPath = await this.categories.ancestorIds(product.categoryId);
    try {
      const variant = await this.prisma.scoped.$transaction(async (tx) => {
        const created = await this.createVariant(tx, user, product, input, {
          isDefault: false,
          defaultSku: undefined,
          categoryPath,
        });
        await this.audit.record(tx, {
          action: 'variant.create',
          entityType: 'ProductVariant',
          entityId: created.id,
          after: toVariantDto(created, true) as unknown as Record<string, unknown>,
        });
        return created;
      });
      return toVariantDto(variant, canViewCost(user));
    } catch (err) {
      throw conflictFrom(err, PRODUCT_COLUMNS) ?? err;
    }
  }

  async updateVariant(user: AuthUser, id: string, dto: UpdateVariantDto): Promise<VariantDto> {
    const existing = await this.prisma.scoped.productVariant.findFirst({
      where: { id },
      include: { product: true },
    });
    if (!existing) throw new NotFoundAppException();
    if (existing.product.status === 'ARCHIVED') throw archivedError();

    const details: Record<string, string[]> = {};
    for (const f of [
      'priceOverride',
      'costOverride',
      'weight',
      'minStockLevel',
      'maxStockLevel',
    ] as const) {
      nonNegative(details, f, dto[f]);
    }
    requireDetails(details);
    const customFields =
      dto.customFields === undefined
        ? undefined
        : await this.fields.validate('VARIANT', dto.customFields, {
            categoryId: existing.product.categoryId,
            categoryPath: await this.categories.ancestorIds(existing.product.categoryId),
            productType: existing.product.type,
            status: dto.status ?? existing.status,
            existing: existing.customFields as Record<string, unknown>,
          });

    try {
      const updated = await this.prisma.scoped.$transaction(async (tx) => {
        const row = await tx.productVariant.update({
          where: { id },
          data: {
            sku: dto.sku?.trim(),
            barcode: dto.barcode === undefined ? undefined : dto.barcode?.trim() || null,
            name: dto.name === undefined ? undefined : dto.name?.trim() || null,
            priceOverride: dto.priceOverride,
            costOverride: dto.costOverride,
            weight: dto.weight,
            minStockLevel: dto.minStockLevel,
            maxStockLevel: dto.maxStockLevel,
            status: dto.status,
            customFields: customFields as Prisma.InputJsonValue | undefined,
          },
        });
        await tx.product.update({
          where: { id: existing.productId },
          data: { version: { increment: 1 } },
        });
        await this.audit.record(tx, {
          action: 'variant.update',
          entityType: 'ProductVariant',
          entityId: id,
          before: toVariantDto(existing, true) as unknown as Record<string, unknown>,
          after: toVariantDto(row, true) as unknown as Record<string, unknown>,
        });
        return row;
      });
      return toVariantDto(updated, canViewCost(user));
    } catch (err) {
      throw conflictFrom(err, PRODUCT_COLUMNS) ?? err;
    }
  }

  /**
   * One Variant per combination of the chosen variant-axis fields' options (Requirement 36.7).
   * SKU = `{code}-{option1}-{option2}`; combinations that already exist are skipped.
   */
  async generateVariants(
    user: AuthUser,
    productId: string,
    dto: GenerateVariantsDto,
  ): Promise<{ created: VariantDto[]; skipped: number }> {
    const product = await this.row(productId);
    if (product.status === 'ARCHIVED') throw archivedError();

    const definitions = await this.fields.definitions('VARIANT');
    const axes = dto.axes.map((axis) => {
      const definition = definitions.find((d) => d.key === axis.key && d.active && d.isVariantAxis);
      if (!definition || (definition.type !== 'DROPDOWN' && definition.type !== 'MULTI_SELECT')) {
        throw new ValidationFailedException({
          axes: [`${axis.key} is not an active variant-axis field with options`],
        });
      }
      const all = optionsOf(definition).map((o) => o.key);
      const chosen = axis.optionKeys ?? all;
      const unknown = chosen.filter((k) => !all.includes(k));
      if (unknown.length > 0 || chosen.length === 0) {
        throw new ValidationFailedException({
          axes: [`${axis.key}: choose from ${all.join(', ')}`],
        });
      }
      return { key: axis.key, options: [...new Set(chosen)] };
    });
    if (new Set(axes.map((a) => a.key)).size !== axes.length || axes.length === 0) {
      throw new ValidationFailedException({ axes: ['give each axis once, and at least one axis'] });
    }

    const combinations = axes.reduce<Array<Record<string, string>>>(
      (acc, axis) => acc.flatMap((combo) => axis.options.map((o) => ({ ...combo, [axis.key]: o }))),
      [{}],
    );
    if (combinations.length > MAX_VARIANTS_PER_GENERATION) {
      throw new ValidationFailedException({
        axes: [
          `this would create ${combinations.length} variants; the limit is ${MAX_VARIANTS_PER_GENERATION}`,
        ],
      });
    }

    const axisKeys = axes.map((a) => a.key);
    const signature = (values: Record<string, unknown>) =>
      axisKeys.map((k) => String(values[k] ?? '')).join('\u0000');
    const existing = product.variants.filter((v) => v.status !== 'ARCHIVED');
    const have = new Set(existing.map((v) => signature(v.customFields as Record<string, unknown>)));
    const fresh = combinations.filter((c) => !have.has(signature(c)));

    try {
      const created = await this.prisma.scoped.$transaction(async (tx) => {
        // The auto-created default variant has no axis values: once real combinations exist it is retired.
        const blankDefault = existing.find(
          (v) =>
            v.isDefault &&
            axisKeys.every((k) => (v.customFields as Record<string, unknown>)[k] === undefined),
        );
        const retire = blankDefault !== undefined && existing.length === 1 && fresh.length > 0;
        if (retire && blankDefault) {
          await tx.productVariant.update({
            where: { id: blankDefault.id },
            data: { status: 'ARCHIVED', isDefault: false },
          });
        }
        const out: ProductVariant[] = [];
        for (const [index, combo] of fresh.entries()) {
          const row = await tx.productVariant.create({
            data: {
              workspaceId: user.workspaceId,
              productId,
              sku: [product.code, ...axisKeys.map((k) => combo[k])].join('-'),
              isDefault: retire && index === 0,
              customFields: combo as Prisma.InputJsonValue,
            },
          });
          out.push(row);
        }
        if (out.length > 0) {
          await tx.product.update({
            where: { id: productId },
            data: { version: { increment: 1 } },
          });
          await this.audit.record(tx, {
            action: 'product.generate_variants',
            entityType: 'Product',
            entityId: productId,
            after: { created: out.map((v) => v.sku), skipped: combinations.length - out.length },
          });
        }
        return out;
      });
      return {
        created: created.map((v) => toVariantDto(v, canViewCost(user))),
        skipped: combinations.length - created.length,
      };
    } catch (err) {
      const conflict = conflictFrom(err, PRODUCT_COLUMNS);
      if (conflict) {
        throw new AppException(
          'POSSIBLE_DUPLICATE',
          409,
          'A generated SKU is already used by another variant',
          {
            sku: ['a generated SKU is already in use in this workspace'],
          },
        );
      }
      throw err;
    }
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────

  async row(
    id: string,
  ): Promise<
    Product & { variants: ProductVariant[]; images: Prisma.ProductImageGetPayload<object>[] }
  > {
    const product = await this.prisma.scoped.product.findFirst({ where: { id }, include: INCLUDE });
    if (!product) throw new NotFoundAppException();
    return product;
  }

  /** Validates references, rules and custom fields; returns what to write. */
  private async prepare(
    dto: CreateProductDto | UpdateProductDto,
    existing: ProductRow | undefined,
  ): Promise<{
    data: ProductScalarData;
    customFields: Record<string, unknown> | undefined;
    categoryPath: string[];
  }> {
    const details: Record<string, string[]> = {};
    nonNegative(details, 'basePrice', dto.basePrice);
    nonNegative(details, 'costPrice', dto.costPrice);
    for (const f of ['saleUnitFactor', 'purchaseUnitFactor'] as const) {
      const value = dto[f];
      if (value !== undefined && !(Number(value) > 0)) details[f] = ['must be greater than zero'];
    }
    const type = dto.type ?? existing?.type ?? 'STOCKABLE';
    const tracking = dto.tracking ?? existing?.tracking ?? 'NONE';
    if (NOT_STOCKED.has(type) && tracking !== 'NONE') {
      details.tracking = ['services and non-stockable products are never stock-tracked'];
    }
    requireDetails(details);

    const categoryId =
      dto.categoryId === undefined ? (existing?.categoryId ?? null) : dto.categoryId;
    await this.assertExists('category', categoryId, 'categoryId');
    await this.assertExists('brand', dto.brandId, 'brandId');
    await this.assertExists('taxClass', dto.taxClassId, 'taxClassId');
    for (const f of ['baseUnitId', 'saleUnitId', 'purchaseUnitId'] as const) {
      await this.assertExists('unit', dto[f], f);
    }

    const categoryPath = await this.categories.ancestorIds(categoryId);
    const customFields =
      dto.customFields === undefined && existing
        ? undefined
        : await this.fields.validate('PRODUCT', dto.customFields ?? {}, {
            categoryId,
            categoryPath,
            productType: type,
            status: dto.status ?? existing?.status ?? 'ACTIVE',
            existing: existing?.customFields as Record<string, unknown> | undefined,
          });

    return {
      categoryPath,
      customFields,
      data: {
        description: dto.description === undefined ? undefined : dto.description?.trim() || null,
        categoryId: dto.categoryId,
        brandId: dto.brandId,
        type: dto.type,
        status: dto.status,
        madeToOrder: dto.madeToOrder,
        tracking: dto.tracking,
        baseUnitId: dto.baseUnitId,
        saleUnitId: dto.saleUnitId,
        purchaseUnitId: dto.purchaseUnitId,
        saleUnitFactor: dto.saleUnitFactor,
        purchaseUnitFactor: dto.purchaseUnitFactor,
        costPrice: dto.costPrice,
        taxClassId: dto.taxClassId,
        tags: cleanList(dto.tags),
        aliases: cleanList(dto.aliases),
        visibleInPos: dto.visibleInPos,
        visibleToAi: dto.visibleToAi,
      },
    };
  }

  /** A reference must name a record of this workspace (the database cannot check that). */
  private async assertExists(
    model: 'category' | 'brand' | 'taxClass' | 'unit',
    id: string | null | undefined,
    field: string,
  ): Promise<void> {
    if (!id) return;
    const delegate = this.prisma.scoped[model] as unknown as {
      findFirst(args: { where: { id: string } }): Promise<unknown>;
    };
    if (!(await delegate.findFirst({ where: { id } }))) {
      throw new ValidationFailedException({ [field]: ['does not exist'] });
    }
  }

  private async createVariant(
    tx: Tx,
    user: AuthUser,
    product: Product,
    input: VariantInputDto,
    options: { isDefault: boolean; defaultSku: string | undefined; categoryPath: string[] },
  ): Promise<ProductVariant> {
    const details: Record<string, string[]> = {};
    for (const f of [
      'priceOverride',
      'costOverride',
      'weight',
      'minStockLevel',
      'maxStockLevel',
    ] as const) {
      nonNegative(details, f, input[f]);
    }
    const sku = (input.sku ?? options.defaultSku)?.trim();
    if (!sku) details.sku = ['is required'];
    requireDetails(details);

    const customFields = await this.fields.validate('VARIANT', input.customFields ?? {}, {
      categoryId: product.categoryId,
      categoryPath: options.categoryPath,
      productType: product.type,
      status: input.status ?? 'ACTIVE',
    });
    return tx.productVariant.create({
      data: {
        workspaceId: user.workspaceId,
        productId: product.id,
        sku: sku as string,
        barcode: input.barcode?.trim() || null,
        name: input.name?.trim() || null,
        isDefault: options.isDefault,
        priceOverride: input.priceOverride,
        costOverride: input.costOverride,
        weight: input.weight,
        minStockLevel: input.minStockLevel,
        maxStockLevel: input.maxStockLevel,
        status: input.status ?? 'ACTIVE',
        customFields: customFields as Prisma.InputJsonValue,
      },
    });
  }

  /** `P-000123`: one more than the highest generated code in the workspace. */
  private async nextCode(tx: Tx, workspaceId: string): Promise<string> {
    const rows = await tx.$queryRaw<Array<{ last: number | null }>>`
      SELECT max(substring(code from 3)::bigint)::int AS last FROM products
      WHERE workspace_id = ${workspaceId} AND code ~ '^P-[0-9]{1,9}$'`;
    return `${CODE_PREFIX}${String((rows[0]?.last ?? 0) + 1).padStart(6, '0')}`;
  }
}

export const archivedError = () =>
  new AppException('PRODUCT_ARCHIVED', 422, 'This product is archived');
