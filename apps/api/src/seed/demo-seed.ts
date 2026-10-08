import { WORKSPACE_PERMISSIONS } from '@bms/types';
import { ClsService } from 'nestjs-cls';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import type { RequestContext } from '../common/context/request-context';
import type { Env } from '../config/env';
import type { PrismaService } from '../common/prisma/prisma.service';
import type { PasswordService } from '../modules/auth/password.service';
import type { TenantsService } from '../modules/tenants/tenants.service';

/** Thrown when seeding is not allowed in the current environment. */
export class SeedRefusedError extends Error {}

/**
 * The demo data is synthetic and meant for the testing environment. In production it is refused
 * unless the operator has deliberately set SEED_ALLOW_PRODUCTION (Requirement 50.3).
 */
export function assertSeedAllowed(env: Pick<Env, 'APP_ENV' | 'SEED_ALLOW_PRODUCTION'>): void {
  if (env.APP_ENV === 'production' && !env.SEED_ALLOW_PRODUCTION) {
    throw new SeedRefusedError(
      'Refusing to seed demo data: APP_ENV is production. Set SEED_ALLOW_PRODUCTION=true only if you really mean it.',
    );
  }
}

export interface DemoServices {
  prisma: PrismaService;
  tenants: TenantsService;
  passwords: PasswordService;
  /** Resolves any application service, so a step can use the same code paths as the API. */
  get<T>(token: abstract new (...args: never[]) => T): T;
}

export interface DemoContext extends DemoServices {
  /** The password given to demo users created (or reset) by this run. */
  password: string;
  resetPasswords: boolean;
  /** Filled in by the `workspace` step; every later step works inside this workspace. */
  workspaceId: string;
  log(message: string): void;
  /**
   * Runs `work` as the demo Owner inside the workspace, the way an API request would, so services
   * that use the tenant-scoped client and audit trail can be called from a seed step.
   */
  asOwner<T>(work: (owner: AuthUser) => Promise<T>): Promise<T>;
}

export interface StepResult {
  created: number;
  existing: number;
}

/**
 * One idempotent piece of the demo dataset. Running a step twice must change nothing the second
 * time. Later tasks add steps (catalog, CRM, orders ...) by appending to DEMO_STEPS.
 */
export interface DemoStep {
  name: string;
  run(ctx: DemoContext): Promise<StepResult>;
}

export interface DemoReport {
  workspaceId: string;
  steps: Array<{ name: string } & StepResult>;
}

export const DEMO_WORKSPACE = {
  name: 'Demo Furniture Co',
  slug: 'demo-furniture-co',
  ownerEmail: 'owner@demo.test',
} as const;

export async function runDemoSeed(
  services: DemoServices,
  steps: readonly DemoStep[],
  options: { password: string; resetPasswords?: boolean; log?: (message: string) => void },
): Promise<DemoReport> {
  const ctx: DemoContext = {
    ...services,
    password: options.password,
    resetPasswords: options.resetPasswords ?? false,
    workspaceId: '',
    log: options.log ?? (() => undefined),
    async asOwner<T>(work: (owner: AuthUser) => Promise<T>): Promise<T> {
      const membership = await services.prisma.unscoped.userWorkspace.findFirstOrThrow({
        where: { workspaceId: ctx.workspaceId, user: { email: DEMO_WORKSPACE.ownerEmail } },
      });
      const owner: AuthUser = {
        userId: membership.userId,
        workspaceId: ctx.workspaceId,
        membershipId: membership.id,
        permissions: [...WORKSPACE_PERMISSIONS],
        permVersion: membership.permVersion,
        familyId: 'seed',
      };
      return services
        .get(ClsService<RequestContext>)
        .runWith({ workspaceId: ctx.workspaceId, userId: owner.userId, actorRole: 'Owner' }, () =>
          work(owner),
        );
    },
  };
  const results: DemoReport['steps'] = [];
  for (const step of steps) {
    const result = await step.run(ctx);
    ctx.log(`${step.name}: ${result.created} created, ${result.existing} already there`);
    results.push({ name: step.name, ...result });
  }
  return { workspaceId: ctx.workspaceId, steps: results };
}
