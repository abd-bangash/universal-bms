import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_ROLES, DOCUMENT_TYPES, type WorkspaceConfig } from '@bms/types';
import { workspaceConfigSchema, zodIssuesToDetails } from '@bms/validators';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import { AppException, ValidationFailedException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ENV, type Env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { createDefaultConfig, mergeConfig } from './default-config';
import { IndustryProfileService } from './industry-profile.service';
import { WorkspaceDefaultsRegistry } from './registries';

export interface CreateWorkspaceInput {
  name: string;
  industryProfile: string;
  owner: { email: string; firstName: string; lastName: string; password: string };
  currency?: string;
  timezone?: string;
  /** ISO 3166 alpha-2 country, for reading local phone numbers. */
  country?: string;
}

export interface CreatedWorkspace {
  workspaceId: string;
  slug: string;
  ownerUserId: string;
  membershipId: string;
}

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: IndustryProfileService,
    private readonly defaults: WorkspaceDefaultsRegistry,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
    private readonly cls: ClsService<RequestContext>,
    @Inject(ENV) private readonly env: Pick<Env, 'ALLOW_PUBLIC_SIGNUP'>,
  ) {}

  /** Public signup when enabled; otherwise only a Platform_Admin (a valid token of an admin user). */
  async assertMayCreate(authorization: string | undefined): Promise<void> {
    if (this.env.ALLOW_PUBLIC_SIGNUP) return;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
    const claims = token ? this.tokens.verify<{ sub?: string; exp: number }>(token) : null;
    if (claims?.sub) {
      const user = await this.prisma.unscoped.user.findUnique({ where: { id: claims.sub } });
      if (user?.isPlatformAdmin && user.status === 'ACTIVE') return;
    }
    throw new AppException('PERMISSION_DENIED', 403, 'Workspace creation is not available');
  }

  /**
   * Creates a workspace with everything it needs to run, in one transaction (Requirement 50.1):
   * validated default config, Owner user and membership, the nine system roles, the Industry Profile,
   * the default location, numbering sequences, and the defaults other modules registered.
   */
  async createWorkspace(input: CreateWorkspaceInput): Promise<CreatedWorkspace> {
    const email = input.owner.email.trim().toLowerCase();
    const profile = await this.profiles.get(input.industryProfile);
    const passwordHash = await this.passwords.hash(input.owner.password);
    this.passwords.assertPolicy(input.owner.password, email);

    const created = await this.prisma.unscoped.$transaction(
      async (tx) => {
        const slug = await this.uniqueSlug(tx, input.name);
        const merged = mergeConfig(
          createDefaultConfig({
            legalName: input.name,
            currency: input.currency,
            timezone: input.timezone,
            country: input.country,
          }),
          profile.configDefaults,
        );
        const checked = workspaceConfigSchema.safeParse(merged);
        if (!checked.success)
          throw new ValidationFailedException(zodIssuesToDetails(checked.error));
        const config = checked.data as unknown as WorkspaceConfig;

        const workspace = await tx.workspace.create({
          data: {
            name: input.name,
            slug,
            industryProfile: input.industryProfile,
            config: config as never,
          },
        });
        const workspaceId = workspace.id;

        const existing = await tx.user.findUnique({ where: { email } });
        const owner =
          existing ??
          (await tx.user.create({
            data: {
              email,
              firstName: input.owner.firstName,
              lastName: input.owner.lastName,
              status: 'ACTIVE',
              passwordHash,
            },
          }));
        if (existing && (existing.status !== 'ACTIVE' || !existing.passwordHash)) {
          throw new ValidationFailedException({
            'owner.email': ['belongs to an account that is not active'],
          });
        }

        await tx.role.createMany({
          data: DEFAULT_ROLES.map((r) => ({
            workspaceId,
            name: r.name,
            isSystem: true,
            isOwner: r.isOwner,
            permissions: [...r.permissions],
            maxDiscountPercent: r.maxDiscountPercent,
            viewerModules: [],
          })),
        });
        const ownerRole = await tx.role.findFirstOrThrow({ where: { workspaceId, isOwner: true } });

        const location = await tx.inventoryLocation.create({
          data: { workspaceId, name: 'Main Store', type: 'STORE', isDefault: true },
        });
        const membership = await tx.userWorkspace.create({
          data: { workspaceId, userId: owner.id, status: 'ACTIVE', defaultLocationId: location.id },
        });
        await tx.userWorkspaceRole.create({
          data: { workspaceId, userWorkspaceId: membership.id, roleId: ownerRole.id },
        });

        await tx.workspace.update({
          where: { id: workspaceId },
          data: {
            config: {
              ...config,
              inventory: { ...config.inventory, defaultLocationId: location.id },
            } as never,
          },
        });

        await this.profiles.apply(workspaceId, input.industryProfile, tx);

        const year = new Date().getUTCFullYear();
        await tx.documentSequence.createMany({
          skipDuplicates: true,
          data: DOCUMENT_TYPES.map((docType) => ({
            workspaceId,
            docType,
            year: config.numbering[docType].includeYear ? year : 0,
          })),
        });

        await this.defaults.run(tx, { workspaceId, ownerUserId: owner.id, profile });

        await this.audit.record(tx, {
          workspaceId,
          action: 'workspace.create',
          entityType: 'Workspace',
          entityId: workspaceId,
          actor: { userId: owner.id },
          after: { name: input.name, slug, industryProfile: input.industryProfile },
        });
        return { workspaceId, slug, ownerUserId: owner.id, membershipId: membership.id };
      },
      { timeout: 30_000 },
    );
    return created;
  }

  private async uniqueSlug(
    tx: Parameters<Parameters<PrismaService['unscoped']['$transaction']>[0]>[0],
    name: string,
  ): Promise<string> {
    const base = slugify(name);
    for (let n = 1; n < 1000; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      if (!(await tx.workspace.findUnique({ where: { slug: candidate }, select: { id: true } })))
        return candidate;
    }
    throw new AppException('INTERNAL_ERROR', 500, 'Could not allocate a workspace address');
  }
}
