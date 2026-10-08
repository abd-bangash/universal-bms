import { Injectable } from '@nestjs/common';
import { Prisma, type FieldDefinition } from '@prisma/client';
import {
  buildFieldSnapshot,
  validateCustomFields,
  type FieldDefinitionLike,
  type FieldSnapshotEntry,
} from '@bms/calc';
import { conditionSchema } from '@bms/validators';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { NotFoundAppException, ValidationFailedException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateFieldDto, FieldEntityName, UpdateFieldDto } from './dto/fields.dto';
import { FieldUsageRegistry } from './field-usage.registry';

export interface FieldDto {
  id: string;
  entityType: string;
  key: string;
  label: string;
  type: string;
  unitDimension: string | null;
  defaultUnit: string | null;
  options: Array<{ key: string; label: string }>;
  required: boolean;
  defaultValue: unknown;
  categoryId: string | null;
  visibleWhen: unknown;
  isVariantAxis: boolean;
  sortOrder: number;
  active: boolean;
  isSystem: boolean;
}

/** What a record tells the validator about itself (category scope, visibility conditions). */
export interface RecordContext {
  categoryId?: string | null;
  productType?: string | null;
  status?: string | null;
  /** Values already stored: deactivated fields keep theirs (Requirement 26.6). */
  existing?: Record<string, unknown>;
}

export const toFieldDto = (row: FieldDefinition): FieldDto => ({
  id: row.id,
  entityType: row.entityType,
  key: row.key,
  label: row.label,
  type: row.type,
  unitDimension: row.unitDimension,
  defaultUnit: row.defaultUnit,
  options: (row.options as Array<{ key: string; label: string }>) ?? [],
  required: row.required,
  defaultValue: row.defaultValue,
  categoryId: row.categoryId,
  visibleWhen: row.visibleWhen,
  isVariantAxis: row.isVariantAxis,
  sortOrder: row.sortOrder,
  active: row.active,
  isSystem: row.isSystem,
});

const asLike = (row: FieldDefinition): FieldDefinitionLike => ({
  key: row.key,
  label: row.label,
  type: row.type,
  unitDimension: row.unitDimension,
  defaultUnit: row.defaultUnit,
  options: row.options,
  required: row.required,
  defaultValue: row.defaultValue,
  categoryId: row.categoryId,
  visibleWhen: row.visibleWhen as FieldDefinitionLike['visibleWhen'],
  active: row.active,
  sortOrder: row.sortOrder,
});

@Injectable()
export class FieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly usage: FieldUsageRegistry,
  ) {}

  async list(entityType: FieldEntityName, includeInactive = false): Promise<FieldDto[]> {
    const rows = await this.rows(entityType, includeInactive);
    return rows.map(toFieldDto);
  }

  async create(actor: AuthUser, dto: CreateFieldDto): Promise<FieldDto> {
    const clash = await this.prisma.scoped.fieldDefinition.findFirst({
      where: { entityType: dto.entityType, key: dto.key },
    });
    if (clash) throw new ValidationFailedException({ key: ['is already used by another field'] });
    const data = this.checked(dto.type, dto);

    const created = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.fieldDefinition.create({
        data: {
          workspaceId: actor.workspaceId,
          entityType: dto.entityType,
          key: dto.key,
          label: dto.label.trim(),
          type: dto.type,
          unitDimension: data.unitDimension,
          defaultUnit: data.defaultUnit,
          options: data.options,
          required: dto.required ?? false,
          defaultValue: json(dto.defaultValue),
          categoryId: dto.categoryId ?? null,
          visibleWhen: json(data.visibleWhen),
          isVariantAxis: dto.isVariantAxis ?? false,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      await this.audit.record(tx, {
        action: 'field.create',
        entityType: 'FieldDefinition',
        entityId: row.id,
        after: toFieldDto(row) as unknown as Record<string, unknown>,
      });
      return row;
    });
    return toFieldDto(created);
  }

  async update(id: string, dto: UpdateFieldDto): Promise<FieldDto> {
    const existing = await this.prisma.scoped.fieldDefinition.findFirst({ where: { id } });
    if (!existing) throw new NotFoundAppException();

    const changesIdentity =
      (dto.key !== undefined && dto.key !== existing.key) ||
      (dto.type !== undefined && dto.type !== existing.type);
    if (changesIdentity && (await this.usage.isUsed(existing.entityType, existing.key))) {
      throw new ValidationFailedException({
        [dto.key !== undefined && dto.key !== existing.key ? 'key' : 'type']: [
          'cannot be changed after the field has been used; deactivate it and add a new one',
        ],
      });
    }
    if (dto.key !== undefined && dto.key !== existing.key) {
      const clash = await this.prisma.scoped.fieldDefinition.findFirst({
        where: { entityType: existing.entityType, key: dto.key },
      });
      if (clash) throw new ValidationFailedException({ key: ['is already used by another field'] });
    }

    const type = dto.type ?? existing.type;
    const merged = {
      unitDimension: dto.unitDimension === undefined ? existing.unitDimension : dto.unitDimension,
      defaultUnit: dto.defaultUnit === undefined ? existing.defaultUnit : dto.defaultUnit,
      options: dto.options ?? (existing.options as Array<{ key: string; label: string }>),
      visibleWhen: dto.visibleWhen === undefined ? existing.visibleWhen : dto.visibleWhen,
    };
    const data = this.checked(type, merged);

    const updated = await this.prisma.scoped.$transaction(async (tx) => {
      const row = await tx.fieldDefinition.update({
        where: { id },
        data: {
          key: dto.key,
          type: dto.type,
          label: dto.label?.trim(),
          unitDimension: data.unitDimension,
          defaultUnit: data.defaultUnit,
          options: data.options,
          required: dto.required,
          defaultValue: dto.defaultValue === undefined ? undefined : json(dto.defaultValue),
          categoryId: dto.categoryId,
          visibleWhen: dto.visibleWhen === undefined ? undefined : json(data.visibleWhen),
          isVariantAxis: dto.isVariantAxis,
          sortOrder: dto.sortOrder,
          active: dto.active,
        },
      });
      await this.audit.record(tx, {
        action: dto.active === false ? 'field.deactivate' : 'field.update',
        entityType: 'FieldDefinition',
        entityId: id,
        before: toFieldDto(existing) as unknown as Record<string, unknown>,
        after: toFieldDto(row) as unknown as Record<string, unknown>,
      });
      return row;
    });
    return toFieldDto(updated);
  }

  // ── used by every module that stores customFields ───────────────────────────────────────────

  /** Active and deactivated definitions of an entity type (deactivated ones keep stored values). */
  async definitions(entityType: FieldEntityName): Promise<FieldDefinition[]> {
    return this.rows(entityType, true);
  }

  /**
   * Validates `values` for a record on write. Throws 400 with `customFields.<key>` field errors
   * (Requirement 26.3); returns the normalised values to store.
   */
  async validate(
    entityType: FieldEntityName,
    values: Record<string, unknown> | null | undefined,
    record: RecordContext = {},
  ): Promise<Record<string, unknown>> {
    const [definitions, units] = await Promise.all([
      this.rows(entityType, true),
      this.prisma.scoped.unit.findMany({ select: { symbol: true, dimension: true } }),
    ]);
    const result = validateCustomFields(definitions.map(asLike), values, {
      values: {},
      categoryId: record.categoryId,
      productType: record.productType,
      status: record.status,
      existing: record.existing,
      units: Object.fromEntries(units.map((u) => [u.symbol, u.dimension])),
    });
    if (!result.ok) {
      throw new ValidationFailedException(
        Object.fromEntries(
          Object.entries(result.errors).map(([key, messages]) => [`customFields.${key}`, messages]),
        ),
      );
    }
    return result.values;
  }

  /** The label/value/unit snapshot stored on an order or quotation line (Requirement 26.8). */
  async snapshot(
    entityType: FieldEntityName,
    values: Record<string, unknown> | null | undefined,
  ): Promise<FieldSnapshotEntry[]> {
    return buildFieldSnapshot((await this.rows(entityType, true)).map(asLike), values);
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────

  private rows(entityType: FieldEntityName, includeInactive: boolean): Promise<FieldDefinition[]> {
    return this.prisma.scoped.fieldDefinition.findMany({
      where: { entityType, ...(includeInactive ? {} : { active: true }) },
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
  }

  /** Type-specific rules for a definition's own settings. */
  private checked(
    type: string,
    input: {
      unitDimension?: string | null;
      defaultUnit?: string | null;
      options?: Array<{ key: string; label: string }>;
      visibleWhen?: unknown;
    },
  ) {
    const errors: Record<string, string[]> = {};
    const options = input.options ?? [];
    if (type === 'DROPDOWN' || type === 'MULTI_SELECT') {
      if (options.length === 0) errors.options = ['at least one option is required'];
      if (new Set(options.map((o) => o.key)).size !== options.length) {
        errors.options = ['option keys must be unique'];
      }
    } else if (options.length > 0) {
      errors.options = ['are only allowed for dropdown and multi-select fields'];
    }
    if (type === 'MEASUREMENT') {
      if (!input.unitDimension) errors.unitDimension = ['is required for a measurement field'];
    } else if (input.unitDimension) {
      errors.unitDimension = ['is only allowed for a measurement field'];
    }
    let visibleWhen: unknown = null;
    if (input.visibleWhen !== undefined && input.visibleWhen !== null) {
      const parsed = conditionSchema.safeParse(input.visibleWhen);
      if (parsed.success) visibleWhen = parsed.data;
      else errors.visibleWhen = ['is not a valid condition'];
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedException(errors);
    return {
      unitDimension: type === 'MEASUREMENT' ? (input.unitDimension ?? null) : null,
      defaultUnit: type === 'MEASUREMENT' ? (input.defaultUnit ?? null) : null,
      options: options as unknown as Prisma.InputJsonValue,
      visibleWhen,
    };
  }
}

/** Prisma needs an explicit marker for a JSON null. */
const json = (value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value === undefined || value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
