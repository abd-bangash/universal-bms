import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DEFAULT_MODULES, DEFAULT_TERMINOLOGY, type WorkspaceConfig } from '@bms/types';
import { industryProfileSchema, type IndustryProfileDefinition } from '@bms/validators';
import type { Logger } from 'pino';
import { NotFoundAppException } from '../../common/errors/app.exception';
import { LOGGER } from '../../common/logging/app-logger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { loadBuiltInProfiles } from './industry-profile.loader';
import { ProfileSectionRegistry, type Tx } from './registries';

export interface ApplyProfileResult {
  fieldDefinitions: number;
  workflows: number;
  states: number;
  transitions: number;
  units: number;
  terminologyChanged: boolean;
  modulesChanged: boolean;
  sections: string[];
}

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

@Injectable()
export class IndustryProfileService implements OnApplicationBootstrap {
  private readonly builtIn = loadBuiltInProfiles();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sections: ProfileSectionRegistry,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /** Keeps the IndustryProfile table in step with the profiles shipped in the code. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.syncBuiltIn();
    } catch (err) {
      this.logger.error(
        { err },
        'could not sync industry profiles; readiness will report the database',
      );
    }
  }

  async syncBuiltIn(): Promise<number> {
    for (const profile of this.builtIn.values()) {
      await this.prisma.unscoped.industryProfile.upsert({
        where: { key: profile.key },
        update: { name: profile.name, definition: json(profile) },
        create: { key: profile.key, name: profile.name, definition: json(profile) },
      });
    }
    return this.builtIn.size;
  }

  async list(): Promise<Array<{ key: string; name: string }>> {
    const rows = await this.prisma.unscoped.industryProfile.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
      select: { key: true, name: true },
    });
    return rows;
  }

  async get(key: string, tx?: Tx): Promise<IndustryProfileDefinition> {
    const row = await (tx ?? this.prisma.unscoped).industryProfile.findUnique({ where: { key } });
    if (!row || !row.active) throw new NotFoundAppException('Industry profile not found');
    return industryProfileSchema.parse(row.definition);
  }

  /**
   * Applies a profile to a workspace. Additive and idempotent: it creates what is missing and
   * never deletes or overwrites what the business added or edited. Pass `tx` to join a transaction.
   */
  async apply(workspaceId: string, key: string, tx?: Tx): Promise<ApplyProfileResult> {
    if (tx) return this.applyIn(tx, workspaceId, key);
    return this.prisma.unscoped.$transaction((inner) => this.applyIn(inner, workspaceId, key), {
      timeout: 30_000,
    });
  }

  private async applyIn(tx: Tx, workspaceId: string, key: string): Promise<ApplyProfileResult> {
    const profile = await this.get(key, tx);
    const result: ApplyProfileResult = {
      fieldDefinitions: 0,
      workflows: 0,
      states: 0,
      transitions: 0,
      units: 0,
      terminologyChanged: false,
      modulesChanged: false,
      sections: [],
    };

    // Field definitions
    const fields = await tx.fieldDefinition.createMany({
      skipDuplicates: true,
      data: profile.fieldDefinitions.map((f) => ({
        workspaceId,
        entityType: f.entityType,
        key: f.key,
        label: f.label,
        type: f.type,
        unitDimension: f.unitDimension ?? null,
        defaultUnit: f.defaultUnit ?? null,
        options: json(f.options),
        required: f.required,
        visibleWhen: f.visibleWhen === undefined ? undefined : json(f.visibleWhen),
        isVariantAxis: f.isVariantAxis,
        sortOrder: f.sortOrder,
        isSystem: true,
      })),
    });
    result.fieldDefinitions = fields.count;

    // Workflows: states and transitions
    for (const wf of profile.workflows) {
      let workflow = await tx.workflow.findUnique({
        where: { workspaceId_entityType: { workspaceId, entityType: wf.entityType } },
      });
      if (!workflow) {
        workflow = await tx.workflow.create({
          data: { workspaceId, entityType: wf.entityType, name: wf.name },
        });
        result.workflows += 1;
      }
      const states = await tx.workflowState.createMany({
        skipDuplicates: true,
        data: wf.states.map((s, index) => ({
          workspaceId,
          workflowId: workflow.id,
          key: s.key,
          label: s.label,
          color: s.color,
          category: s.category,
          systemRole: s.systemRole ?? null,
          isInitial: s.isInitial,
          sortOrder: index * 10,
        })),
      });
      result.states += states.count;

      const stored = await tx.workflowState.findMany({
        where: { workflowId: workflow.id },
        select: { id: true, key: true },
      });
      const idByKey = new Map(stored.map((s) => [s.key, s.id]));
      const transitions = await tx.workflowTransition.createMany({
        skipDuplicates: true,
        data: wf.transitions.map((t) => ({
          workspaceId,
          workflowId: workflow.id,
          fromStateId: idByKey.get(t.from) as string,
          toStateId: idByKey.get(t.to) as string,
          requiredPermission: t.requiredPermission ?? null,
          requiredFields: t.requiredFields,
          requiresApproval: t.requiresApproval,
        })),
      });
      result.transitions += transitions.count;
    }

    // Units
    const units = await tx.unit.createMany({
      skipDuplicates: true,
      data: profile.units.map((u) => ({
        workspaceId,
        name: u.name,
        symbol: u.symbol,
        dimension: u.dimension,
        toBase: u.toBase,
      })),
    });
    result.units = units.count;

    // Terminology and module toggles: replace only what the business has not changed yet.
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const config = structuredClone(workspace.config) as unknown as WorkspaceConfig;
    for (const [term, value] of Object.entries(profile.terminology) as Array<
      [keyof typeof DEFAULT_TERMINOLOGY, { singular: string; plural: string }]
    >) {
      const current = config.terminology?.[term];
      const untouched =
        !current ||
        (current.singular === DEFAULT_TERMINOLOGY[term].singular &&
          current.plural === DEFAULT_TERMINOLOGY[term].plural);
      if (untouched && (current?.singular !== value.singular || current?.plural !== value.plural)) {
        config.terminology = { ...config.terminology, [term]: value };
        result.terminologyChanged = true;
      }
    }
    for (const [module, enabled] of Object.entries(profile.modules)) {
      const current = (config.modules as unknown as Record<string, boolean | undefined>)[module];
      const untouched =
        current === undefined ||
        current === (DEFAULT_MODULES as unknown as Record<string, boolean>)[module];
      if (untouched && current !== enabled) {
        (config.modules as unknown as Record<string, boolean>)[module] = enabled;
        result.modulesChanged = true;
      }
    }
    const changedConfig = result.terminologyChanged || result.modulesChanged;
    if (changedConfig || workspace.industryProfile !== key) {
      await tx.workspace.update({
        where: { id: workspaceId },
        data: {
          industryProfile: key,
          ...(changedConfig ? { config: json(config), configVersion: { increment: 1 } } : {}),
        },
      });
    }

    result.sections = await this.sections.apply(tx, workspaceId, profile);
    return result;
  }
}
