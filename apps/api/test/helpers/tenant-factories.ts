import { randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

/**
 * Creates one row of a tenant model inside a workspace, using the raw client, and returns a `where`
 * that identifies it. Every schema task that adds a tenant model must register a factory here;
 * the tenant-isolation property test fails for a tenant model that has none.
 */
export type TenantFactory = (
  prisma: PrismaClient,
  workspaceId: string,
) => Promise<{ where: Record<string, unknown> }>;

const rand = () => randomBytes(5).toString('hex');

export async function ensureWorkspace(prisma: PrismaClient, id: string): Promise<void> {
  await prisma.workspace.upsert({
    where: { id },
    update: {},
    create: { id, name: id, slug: id, industryProfile: 'furniture' },
  });
}

export async function makeUser(prisma: PrismaClient): Promise<{ id: string }> {
  return prisma.user.create({
    data: { email: `u_${rand()}@example.test`, firstName: 'Test', lastName: 'User' },
    select: { id: true },
  });
}

async function makeMembership(prisma: PrismaClient, workspaceId: string) {
  const user = await makeUser(prisma);
  return prisma.userWorkspace.create({ data: { workspaceId, userId: user.id } });
}

async function makeWorkflow(prisma: PrismaClient, workspaceId: string) {
  return prisma.workflow.create({ data: { workspaceId, entityType: 'LEAD', name: 'Lead' } });
}

async function makeState(prisma: PrismaClient, workspaceId: string, workflowId: string) {
  return prisma.workflowState.create({
    data: { workspaceId, workflowId, key: `s_${rand()}`, label: 'State', category: 'OPEN' },
  });
}

async function makeProduct(prisma: PrismaClient, workspaceId: string) {
  return prisma.product.create({
    data: { workspaceId, code: `p_${rand()}`, name: 'Product', basePrice: '10' },
  });
}

async function makeVariant(prisma: PrismaClient, workspaceId: string) {
  const product = await makeProduct(prisma, workspaceId);
  return prisma.productVariant.create({
    data: { workspaceId, productId: product.id, sku: `s_${rand()}` },
  });
}

const byId = (row: { id: string }) => ({ where: { id: row.id } });

const factories: Record<string, TenantFactory> = {
  UserWorkspace: async (p, ws) => byId(await makeMembership(p, ws)),
  Role: async (p, ws) =>
    byId(await p.role.create({ data: { workspaceId: ws, name: `r_${rand()}`, permissions: [] } })),
  UserWorkspaceRole: async (p, ws) => {
    const membership = await makeMembership(p, ws);
    const role = await p.role.create({
      data: { workspaceId: ws, name: `r_${rand()}`, permissions: [] },
    });
    await p.userWorkspaceRole.create({
      data: { workspaceId: ws, userWorkspaceId: membership.id, roleId: role.id },
    });
    return { where: { userWorkspaceId: membership.id, roleId: role.id } };
  },
  Invitation: async (p, ws) => {
    const inviter = await makeUser(p);
    return byId(
      await p.invitation.create({
        data: {
          workspaceId: ws,
          email: `i_${rand()}@example.test`,
          tokenHash: rand(),
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedById: inviter.id,
        },
      }),
    );
  },
  AuditEvent: async (p, ws) =>
    byId(
      await p.auditEvent.create({
        data: { workspaceId: ws, action: 'test.create', entityType: 'Test', entityId: rand() },
      }),
    ),
  IdempotencyKey: async (p, ws) =>
    byId(
      await p.idempotencyKey.create({
        data: { workspaceId: ws, key: rand(), route: 'POST /x', requestHash: rand() },
      }),
    ),
  DocumentSequence: async (p, ws) =>
    byId(await p.documentSequence.create({ data: { workspaceId: ws, docType: 'QUOTATION' } })),
  FileAsset: async (p, ws) =>
    byId(
      await p.fileAsset.create({
        data: {
          workspaceId: ws,
          storageKey: rand(),
          originalName: 'a.png',
          mimeType: 'image/png',
          sizeBytes: 1,
        },
      }),
    ),
  FieldDefinition: async (p, ws) =>
    byId(
      await p.fieldDefinition.create({
        data: {
          workspaceId: ws,
          entityType: 'PRODUCT',
          key: `k_${rand()}`,
          label: 'K',
          type: 'TEXT',
        },
      }),
    ),
  Workflow: async (p, ws) => byId(await makeWorkflow(p, ws)),
  WorkflowState: async (p, ws) => {
    const wf = await makeWorkflow(p, ws);
    return byId(await makeState(p, ws, wf.id));
  },
  WorkflowTransition: async (p, ws) => {
    const wf = await makeWorkflow(p, ws);
    const from = await makeState(p, ws, wf.id);
    const to = await makeState(p, ws, wf.id);
    return byId(
      await p.workflowTransition.create({
        data: { workspaceId: ws, workflowId: wf.id, fromStateId: from.id, toStateId: to.id },
      }),
    );
  },
  StatusHistory: async (p, ws) =>
    byId(
      await p.statusHistory.create({
        data: { workspaceId: ws, entityType: 'LEAD', entityId: rand(), toKey: 'NEW' },
      }),
    ),
  ApprovalRequest: async (p, ws) => {
    const user = await makeUser(p);
    return byId(
      await p.approvalRequest.create({
        data: {
          workspaceId: ws,
          type: 'DISCOUNT',
          entityType: 'ORDER',
          entityId: rand(),
          payload: {},
          requestedById: user.id,
        },
      }),
    );
  },
  Unit: async (p, ws) =>
    byId(
      await p.unit.create({
        data: {
          workspaceId: ws,
          name: 'Piece',
          symbol: `u_${rand()}`,
          dimension: 'count',
          toBase: '1',
        },
      }),
    ),
  TaxClass: async (p, ws) =>
    byId(await p.taxClass.create({ data: { workspaceId: ws, name: `t_${rand()}`, rate: '0.17' } })),
  InventoryLocation: async (p, ws) =>
    byId(await p.inventoryLocation.create({ data: { workspaceId: ws, name: `l_${rand()}` } })),
  Task: async (p, ws) =>
    byId(await p.task.create({ data: { workspaceId: ws, type: 'TODO', title: 'Do it' } })),
  Note: async (p, ws) =>
    byId(
      await p.note.create({
        data: { workspaceId: ws, entityType: 'CUSTOMER', entityId: rand(), body: 'hello' },
      }),
    ),
  Notification: async (p, ws) => {
    const user = await makeUser(p);
    return byId(
      await p.notification.create({
        data: { workspaceId: ws, userId: user.id, type: 'test', title: 'T' },
      }),
    );
  },
  Category: async (p, ws) =>
    byId(await p.category.create({ data: { workspaceId: ws, name: `c_${rand()}` } })),
  Brand: async (p, ws) =>
    byId(await p.brand.create({ data: { workspaceId: ws, name: `b_${rand()}` } })),
  Product: async (p, ws) => byId(await makeProduct(p, ws)),
  ProductVariant: async (p, ws) => byId(await makeVariant(p, ws)),
  ProductImage: async (p, ws) => {
    const product = await makeProduct(p, ws);
    const file = await p.fileAsset.create({
      data: {
        workspaceId: ws,
        storageKey: `k_${rand()}`,
        originalName: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 1,
      },
    });
    return byId(
      await p.productImage.create({
        data: { workspaceId: ws, productId: product.id, fileId: file.id },
      }),
    );
  },
  BundleComponent: async (p, ws) => {
    const bundle = await makeProduct(p, ws);
    const variant = await makeVariant(p, ws);
    return byId(
      await p.bundleComponent.create({
        data: {
          workspaceId: ws,
          bundleProductId: bundle.id,
          componentVariantId: variant.id,
          quantity: '1',
        },
      }),
    );
  },
  PriceList: async (p, ws) =>
    byId(await p.priceList.create({ data: { workspaceId: ws, name: `pl_${rand()}` } })),
  PriceListItem: async (p, ws) => {
    const list = await p.priceList.create({ data: { workspaceId: ws, name: `pl_${rand()}` } });
    const variant = await makeVariant(p, ws);
    return byId(
      await p.priceListItem.create({
        data: { workspaceId: ws, priceListId: list.id, variantId: variant.id, price: '5' },
      }),
    );
  },
};

export const tenantFactories: Record<string, TenantFactory> = Object.fromEntries(
  Object.entries(factories).map(([model, make]) => [
    model,
    async (prisma: PrismaClient, workspaceId: string) => {
      await ensureWorkspace(prisma, workspaceId);
      return make(prisma, workspaceId);
    },
  ]),
);
