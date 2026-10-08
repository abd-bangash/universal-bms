import { CustomersService } from '../../modules/crm/customers.service';
import { LeadsService } from '../../modules/crm/leads.service';
import { SettingsService } from '../../modules/settings/settings.service';
import { WorkflowService } from '../../modules/workflows/workflow.service';
import type { DemoContext, DemoStep, StepResult } from '../demo-seed';
import { DEMO_CUSTOMERS, DEMO_LEADS, type DemoStage } from './crm.data';

/** The stages a lead passes through on its way to each stage (so the history looks like real work). */
const PATH: Record<DemoStage, string[]> = {
  new: [],
  contacted: ['contacted'],
  qualified: ['contacted', 'qualified'],
  quoted: ['contacted', 'qualified', 'quoted'],
  negotiation: ['contacted', 'qualified', 'quoted', 'negotiation'],
  won: ['contacted', 'qualified', 'won'],
  lost: ['contacted', 'lost'],
};

const inDays = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();

/**
 * 20 customers and 15 leads across every pipeline stage, assigned to the demo staff, with custom
 * sofa/wardrobe requirements, follow-ups, lost reasons and a few leads converted to customers.
 * Everything goes through the real services, so timelines, history and follow-up tasks are genuine.
 */
export const crmStep: DemoStep = {
  name: 'crm',
  async run(ctx: DemoContext): Promise<StepResult> {
    const { unscoped } = ctx.prisma;
    const customers = ctx.get(CustomersService);
    const leads = ctx.get(LeadsService);
    const workflows = ctx.get(WorkflowService);
    const settings = ctx.get(SettingsService);

    // Phone numbers are read with the business country; older demo workspaces were made without one.
    await ctx.asOwner(async () => {
      const current = await settings.get<string | undefined>('locale.defaultCountry');
      if (!current) await settings.update({ locale: { defaultCountry: 'PK' } });
    });

    const staff = new Map(
      (
        await unscoped.userWorkspace.findMany({
          where: { workspaceId: ctx.workspaceId },
          include: { user: true },
        })
      ).map((m) => [m.user.email, m.userId]),
    );
    const products = new Map(
      (
        await unscoped.product.findMany({
          where: { workspaceId: ctx.workspaceId },
          select: { id: true, code: true },
        })
      ).map((p) => [p.code, p.id]),
    );
    const reasons = new Map(
      (await unscoped.lostReason.findMany({ where: { workspaceId: ctx.workspaceId } })).map((r) => [
        r.name,
        r.id,
      ]),
    );
    const haveCustomer = new Set(
      (
        await unscoped.customer.findMany({
          where: { workspaceId: ctx.workspaceId },
          select: { email: true, fullName: true },
        })
      ).map((c) => c.fullName),
    );
    const haveLead = new Set(
      (
        await unscoped.lead.findMany({
          where: { workspaceId: ctx.workspaceId },
          select: { fullName: true },
        })
      ).map((l) => l.fullName),
    );
    let created = 0;
    let existing = 0;

    for (const person of DEMO_CUSTOMERS) {
      if (haveCustomer.has(person.fullName)) {
        existing += 1;
        continue;
      }
      await ctx.asOwner((owner) =>
        customers.create(owner, {
          fullName: person.fullName,
          phones: person.phones,
          email: person.email,
          billingAddress: {
            line1: `${10 + created} Demo Street`,
            city: person.city,
            country: 'Pakistan',
          },
          preferredChannel: person.channel,
          tags: person.tags,
          source: person.source,
          assignedToId: person.assignedTo ? staff.get(person.assignedTo) : undefined,
          confirmDuplicate: true,
        }),
      );
      created += 1;
    }

    for (const item of DEMO_LEADS) {
      if (haveLead.has(item.fullName)) {
        existing += 1;
        continue;
      }
      await ctx.asOwner(async (owner) => {
        const { lead } = await leads.create(owner, {
          fullName: item.fullName,
          phone: item.phone,
          email: item.email,
          source: item.source,
          channel: item.channel,
          campaign: item.campaign,
          interest: item.interest,
          productId: item.productCode ? products.get(item.productCode) : undefined,
          requirements: item.requirements,
          quantity: item.quantity,
          estimatedValue: item.estimatedValue,
          priority: item.priority,
          assignedToId: item.assignedTo ? staff.get(item.assignedTo) : undefined,
          nextAction: item.nextAction,
          nextActionDate:
            item.followUpInDays === undefined ? undefined : inDays(item.followUpInDays),
          customFields: item.customFields,
          allowDuplicate: true,
        });
        const workflow = await workflows.get('LEAD');
        for (const step of PATH[item.stage]) {
          const target = workflow.states.find((s) => s.key === step);
          const lostReasonId =
            target?.systemRole === 'LOST' ? reasons.get(item.lostReason ?? 'Other') : undefined;
          await leads.changeStage(owner, lead.id, { stage: step, lostReasonId });
        }
        if (item.convert) await leads.convert(owner, lead.id, { target: 'CUSTOMER' });
      });
      created += 1;
    }
    return { created, existing };
  },
};
