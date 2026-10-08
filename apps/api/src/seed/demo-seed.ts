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
}

export interface DemoContext extends DemoServices {
  /** The password given to demo users created (or reset) by this run. */
  password: string;
  resetPasswords: boolean;
  /** Filled in by the `workspace` step; every later step works inside this workspace. */
  workspaceId: string;
  log(message: string): void;
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
  };
  const results: DemoReport['steps'] = [];
  for (const step of steps) {
    const result = await step.run(ctx);
    ctx.log(`${step.name}: ${result.created} created, ${result.existing} already there`);
    results.push({ name: step.name, ...result });
  }
  return { workspaceId: ctx.workspaceId, steps: results };
}
