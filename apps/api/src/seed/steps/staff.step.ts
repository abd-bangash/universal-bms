import type { DemoContext, DemoStep, StepResult } from '../demo-seed';

interface DemoPerson {
  role: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string;
  isSalesperson: boolean;
}

/** One synthetic staff member per default role (the Owner is created with the workspace). */
export const DEMO_STAFF: readonly DemoPerson[] = [
  {
    role: 'Manager',
    email: 'manager@demo.test',
    firstName: 'Mina',
    lastName: 'Manager',
    jobTitle: 'General manager',
    isSalesperson: false,
  },
  {
    role: 'Salesperson',
    email: 'salesperson@demo.test',
    firstName: 'Sam',
    lastName: 'Seller',
    jobTitle: 'Showroom salesperson',
    isSalesperson: true,
  },
  {
    role: 'Cashier',
    email: 'cashier@demo.test',
    firstName: 'Cara',
    lastName: 'Counter',
    jobTitle: 'Cashier',
    isSalesperson: true,
  },
  {
    role: 'Inventory Staff',
    email: 'inventory@demo.test',
    firstName: 'Ivan',
    lastName: 'Stock',
    jobTitle: 'Storekeeper',
    isSalesperson: false,
  },
  {
    role: 'Account Staff',
    email: 'accounts@demo.test',
    firstName: 'Ada',
    lastName: 'Ledger',
    jobTitle: 'Accountant',
    isSalesperson: false,
  },
  {
    role: 'Production Staff',
    email: 'production@demo.test',
    firstName: 'Pavel',
    lastName: 'Workshop',
    jobTitle: 'Carpenter',
    isSalesperson: false,
  },
  {
    role: 'AI/Automation Operator',
    email: 'automation@demo.test',
    firstName: 'Ava',
    lastName: 'Operator',
    jobTitle: 'Customer messaging lead',
    isSalesperson: false,
  },
  {
    role: 'Viewer',
    email: 'viewer@demo.test',
    firstName: 'Vera',
    lastName: 'Viewer',
    jobTitle: 'Observer',
    isSalesperson: false,
  },
];

export const staffStep: DemoStep = {
  name: 'staff',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const roles = await unscoped.role.findMany({ where: { workspaceId: ctx.workspaceId } });
    const hash = await ctx.passwords.hash(ctx.password);
    let created = 0;
    let existing = 0;

    const everyone = [{ email: 'owner@demo.test' }, ...DEMO_STAFF];
    for (const person of DEMO_STAFF) {
      const role = roles.find((r) => r.name === person.role);
      if (!role)
        throw new Error(`Default role "${person.role}" is missing from the demo workspace`);

      let user = await unscoped.user.findUnique({ where: { email: person.email } });
      if (user) {
        existing += 1;
      } else {
        user = await unscoped.user.create({
          data: {
            email: person.email,
            firstName: person.firstName,
            lastName: person.lastName,
            status: 'ACTIVE',
            passwordHash: hash,
          },
        });
        created += 1;
      }
      const membership =
        (await unscoped.userWorkspace.findUnique({
          where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: user.id } },
        })) ??
        (await unscoped.userWorkspace.create({
          data: {
            workspaceId: ctx.workspaceId,
            userId: user.id,
            jobTitle: person.jobTitle,
            isSalesperson: person.isSalesperson,
          },
        }));
      await unscoped.userWorkspaceRole.upsert({
        where: { userWorkspaceId_roleId: { userWorkspaceId: membership.id, roleId: role.id } },
        update: {},
        create: { workspaceId: ctx.workspaceId, userWorkspaceId: membership.id, roleId: role.id },
      });
    }

    if (ctx.resetPasswords) {
      const users = await unscoped.user.findMany({
        where: { email: { in: everyone.map((p) => p.email) } },
        select: { id: true },
      });
      await unscoped.user.updateMany({
        where: { id: { in: users.map((u) => u.id) } },
        data: { passwordHash: hash, lockedUntil: null },
      });
      await unscoped.userSession.updateMany({
        where: { userId: { in: users.map((u) => u.id) }, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      ctx.log(`passwords reset for ${users.length} demo users`);
    }
    return { created, existing };
  },
};
