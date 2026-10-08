import { DEMO_WORKSPACE, type DemoContext, type DemoStep, type StepResult } from '../demo-seed';

/** Creates the demo business (furniture profile) once; afterwards only makes sure it is flagged as demo. */
export const workspaceStep: DemoStep = {
  name: 'workspace',
  async run(ctx: DemoContext): Promise<StepResult> {
    const existing = await ctx.prisma.unscoped.workspace.findUnique({
      where: { slug: DEMO_WORKSPACE.slug },
    });
    if (existing) {
      if (!existing.isDemo)
        await ctx.prisma.unscoped.workspace.update({
          where: { id: existing.id },
          data: { isDemo: true },
        });
      ctx.workspaceId = existing.id;
      return { created: 0, existing: 1 };
    }
    const created = await ctx.tenants.createWorkspace({
      name: DEMO_WORKSPACE.name,
      industryProfile: 'furniture',
      owner: {
        email: DEMO_WORKSPACE.ownerEmail,
        firstName: 'Olivia',
        lastName: 'Owner',
        password: ctx.password,
      },
      currency: 'PKR',
      timezone: 'Asia/Karachi',
    });
    await ctx.prisma.unscoped.workspace.update({
      where: { id: created.workspaceId },
      data: { isDemo: true },
    });
    ctx.workspaceId = created.workspaceId;
    return { created: 1, existing: 0 };
  },
};
