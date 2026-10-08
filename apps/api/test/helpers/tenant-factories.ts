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

async function makeCustomer(prisma: PrismaClient, workspaceId: string) {
  return prisma.customer.create({ data: { workspaceId, fullName: `Customer ${rand()}` } });
}

async function makeQuotation(prisma: PrismaClient, workspaceId: string) {
  return prisma.quotation.create({
    data: { workspaceId, quotationNumber: `Q-${rand()}`, subtotal: '10', totalAmount: '10' },
  });
}

async function makeOrder(prisma: PrismaClient, workspaceId: string) {
  const customer = await makeCustomer(prisma, workspaceId);
  const location = await prisma.inventoryLocation.create({
    data: { workspaceId, name: `loc_${rand()}` },
  });
  return prisma.order.create({
    data: {
      workspaceId,
      orderNumber: `O-${rand()}`,
      customerId: customer.id,
      locationId: location.id,
      subtotal: '10',
      totalAmount: '10',
      balanceDue: '10',
    },
  });
}

async function makeAccount(prisma: PrismaClient, workspaceId: string) {
  return prisma.financialAccount.create({
    data: { workspaceId, type: 'CASH', name: `Account ${rand()}` },
  });
}

async function makeMethod(prisma: PrismaClient, workspaceId: string) {
  const account = await makeAccount(prisma, workspaceId);
  return prisma.paymentMethod.create({
    data: { workspaceId, name: `Method ${rand()}`, type: 'CASH', accountId: account.id },
  });
}

async function makePayment(prisma: PrismaClient, workspaceId: string) {
  const order = await makeOrder(prisma, workspaceId);
  const method = await makeMethod(prisma, workspaceId);
  return prisma.payment.create({
    data: {
      workspaceId,
      paymentNumber: `PAY-${rand()}`,
      type: 'ORDER_PAYMENT',
      orderId: order.id,
      customerId: order.customerId,
      paymentMethodId: method.id,
      accountId: method.accountId,
      amount: '10',
    },
  });
}

async function makeReason(prisma: PrismaClient, workspaceId: string) {
  return prisma.adjustmentReason.create({ data: { workspaceId, name: `Reason ${rand()}` } });
}

async function makeLocation(prisma: PrismaClient, workspaceId: string) {
  return prisma.inventoryLocation.create({ data: { workspaceId, name: `Location ${rand()}` } });
}

async function makePosSession(prisma: PrismaClient, workspaceId: string) {
  const member = await makeMembership(prisma, workspaceId);
  const location = await makeLocation(prisma, workspaceId);
  return prisma.posSession.create({
    data: { workspaceId, cashierId: member.userId, locationId: location.id },
  });
}

async function makeReturn(prisma: PrismaClient, workspaceId: string) {
  const order = await makeOrder(prisma, workspaceId);
  return prisma.return.create({
    data: {
      workspaceId,
      returnNumber: `R-${rand()}`,
      orderId: order.id,
      customerId: order.customerId,
      reason: 'Test',
      refundAmount: '0',
      refundTo: 'NONE',
    },
  });
}

async function makeSupplier(prisma: PrismaClient, workspaceId: string) {
  return prisma.supplier.create({ data: { workspaceId, name: `Supplier ${rand()}` } });
}

async function makePurchaseOrder(prisma: PrismaClient, workspaceId: string) {
  const supplier = await makeSupplier(prisma, workspaceId);
  const location = await makeLocation(prisma, workspaceId);
  return prisma.purchaseOrder.create({
    data: {
      workspaceId,
      orderNumber: `PO-${rand()}`,
      supplierId: supplier.id,
      locationId: location.id,
      subtotal: '100',
      totalAmount: '100',
    },
  });
}

async function makeCommissionRule(prisma: PrismaClient, workspaceId: string) {
  return prisma.commissionRule.create({
    data: { workspaceId, name: `Rule ${rand()}`, calcType: 'PERCENTAGE', rate: '5' },
  });
}

async function makeCommission(prisma: PrismaClient, workspaceId: string) {
  const order = await makeOrder(prisma, workspaceId);
  const member = await makeMembership(prisma, workspaceId);
  return prisma.commission.create({
    data: {
      workspaceId,
      orderId: order.id,
      salespersonId: member.userId,
      ruleSnapshot: {},
      calculationBase: '100',
      amount: '5',
    },
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
  Customer: async (p, ws) =>
    byId(await p.customer.create({ data: { workspaceId: ws, fullName: `Customer ${rand()}` } })),
  Lead: async (p, ws) =>
    byId(await p.lead.create({ data: { workspaceId: ws, fullName: `Lead ${rand()}` } })),
  LostReason: async (p, ws) =>
    byId(await p.lostReason.create({ data: { workspaceId: ws, name: `Reason ${rand()}` } })),
  TimelineEntry: async (p, ws) =>
    byId(
      await p.timelineEntry.create({
        data: { workspaceId: ws, type: 'SYSTEM', summary: `Event ${rand()}` },
      }),
    ),
  Quotation: async (p, ws) => byId(await makeQuotation(p, ws)),
  QuotationItem: async (p, ws) => {
    const q = await makeQuotation(p, ws);
    return byId(
      await p.quotationItem.create({
        data: {
          workspaceId: ws,
          quotationId: q.id,
          lineNo: 1,
          name: 'Line',
          quantity: '1',
          listPrice: '10',
          unitPrice: '10',
          lineTotal: '10',
        },
      }),
    );
  },
  Order: async (p, ws) => byId(await makeOrder(p, ws)),
  OrderItem: async (p, ws) => {
    const o = await makeOrder(p, ws);
    return byId(
      await p.orderItem.create({
        data: {
          workspaceId: ws,
          orderId: o.id,
          lineNo: 1,
          name: 'Line',
          quantity: '1',
          listPrice: '10',
          unitPrice: '10',
          lineTotal: '10',
        },
      }),
    );
  },
  OrderSalesperson: async (p, ws) => {
    const o = await makeOrder(p, ws);
    const user = await makeUser(p);
    return byId(
      await p.orderSalesperson.create({
        data: { workspaceId: ws, orderId: o.id, userId: user.id },
      }),
    );
  },
  ProductionJob: async (p, ws) => {
    const o = await makeOrder(p, ws);
    const item = await p.orderItem.create({
      data: {
        workspaceId: ws,
        orderId: o.id,
        lineNo: 1,
        name: 'Line',
        quantity: '1',
        listPrice: '10',
        unitPrice: '10',
        lineTotal: '10',
      },
    });
    return byId(
      await p.productionJob.create({
        data: { workspaceId: ws, orderId: o.id, orderItemId: item.id },
      }),
    );
  },
  Invoice: async (p, ws) => {
    const o = await makeOrder(p, ws);
    return byId(
      await p.invoice.create({
        data: {
          workspaceId: ws,
          invoiceNumber: `INV-${rand()}`,
          orderId: o.id,
          customerId: o.customerId,
          totalAmount: '10',
          data: {},
        },
      }),
    );
  },
  FinancialAccount: async (p, ws) => byId(await makeAccount(p, ws)),
  PaymentMethod: async (p, ws) => byId(await makeMethod(p, ws)),
  Payment: async (p, ws) => byId(await makePayment(p, ws)),
  CustomerCredit: async (p, ws) => {
    const c = await makeCustomer(p, ws);
    return byId(
      await p.customerCredit.create({
        data: { workspaceId: ws, customerId: c.id, amount: '10', reason: 'ADVANCE' },
      }),
    );
  },
  Receipt: async (p, ws) => {
    const payment = await makePayment(p, ws);
    return byId(
      await p.receipt.create({
        data: {
          workspaceId: ws,
          receiptNumber: `RCP-${rand()}`,
          orderId: payment.orderId,
          paymentId: payment.id,
          type: 'PAYMENT',
          data: {},
        },
      }),
    );
  },
  ExpenseCategory: async (p, ws) =>
    byId(await p.expenseCategory.create({ data: { workspaceId: ws, name: `Category ${rand()}` } })),
  Expense: async (p, ws) => {
    const method = await makeMethod(p, ws);
    const category = await p.expenseCategory.create({
      data: { workspaceId: ws, name: `Category ${rand()}` },
    });
    return byId(
      await p.expense.create({
        data: {
          workspaceId: ws,
          categoryId: category.id,
          amount: '10',
          expenseDate: new Date(),
          paymentMethodId: method.id,
          accountId: method.accountId,
        },
      }),
    );
  },
  AdjustmentReason: async (p, ws) => byId(await makeReason(p, ws)),
  StockMovement: async (p, ws) => {
    const v = await makeVariant(p, ws);
    const l = await makeLocation(p, ws);
    return byId(
      await p.stockMovement.create({
        data: {
          workspaceId: ws,
          variantId: v.id,
          locationId: l.id,
          movementType: 'OPENING_STOCK',
          quantityDelta: '5',
        },
      }),
    );
  },
  StockLevel: async (p, ws) => {
    const v = await makeVariant(p, ws);
    const l = await makeLocation(p, ws);
    return byId(
      await p.stockLevel.create({
        data: { workspaceId: ws, variantId: v.id, locationId: l.id, onHand: '5' },
      }),
    );
  },
  StockReservation: async (p, ws) => {
    const o = await makeOrder(p, ws);
    const item = await p.orderItem.create({
      data: {
        workspaceId: ws,
        orderId: o.id,
        lineNo: 1,
        name: 'Line',
        quantity: '1',
        listPrice: '10',
        unitPrice: '10',
        lineTotal: '10',
      },
    });
    const v = await makeVariant(p, ws);
    const l = await makeLocation(p, ws);
    return byId(
      await p.stockReservation.create({
        data: {
          workspaceId: ws,
          orderId: o.id,
          orderItemId: item.id,
          variantId: v.id,
          locationId: l.id,
          quantity: '1',
        },
      }),
    );
  },
  StockCount: async (p, ws) => {
    const l = await makeLocation(p, ws);
    return byId(await p.stockCount.create({ data: { workspaceId: ws, locationId: l.id } }));
  },
  StockCountLine: async (p, ws) => {
    const l = await makeLocation(p, ws);
    const c = await p.stockCount.create({ data: { workspaceId: ws, locationId: l.id } });
    const v = await makeVariant(p, ws);
    return byId(
      await p.stockCountLine.create({
        data: { workspaceId: ws, stockCountId: c.id, variantId: v.id, expectedQty: '3' },
      }),
    );
  },
  CommissionRule: async (p, ws) => byId(await makeCommissionRule(p, ws)),
  Commission: async (p, ws) => byId(await makeCommission(p, ws)),
  Supplier: async (p, ws) => byId(await makeSupplier(p, ws)),
  PurchaseOrder: async (p, ws) => byId(await makePurchaseOrder(p, ws)),
  PurchaseOrderItem: async (p, ws) => {
    const po = await makePurchaseOrder(p, ws);
    const v = await makeVariant(p, ws);
    return byId(
      await p.purchaseOrderItem.create({
        data: {
          workspaceId: ws,
          purchaseOrderId: po.id,
          lineNo: 1,
          variantId: v.id,
          quantity: '2',
          unitCost: '50',
          lineTotal: '100',
        },
      }),
    );
  },
  GoodsReceipt: async (p, ws) => {
    const po = await makePurchaseOrder(p, ws);
    return byId(
      await p.goodsReceipt.create({
        data: {
          workspaceId: ws,
          receiptNumber: `GRN-${rand()}`,
          purchaseOrderId: po.id,
          lines: [],
        },
      }),
    );
  },
  SupplierPayment: async (p, ws) => {
    const po = await makePurchaseOrder(p, ws);
    const method = await makeMethod(p, ws);
    return byId(
      await p.supplierPayment.create({
        data: {
          workspaceId: ws,
          supplierId: po.supplierId,
          purchaseOrderId: po.id,
          paymentMethodId: method.id,
          accountId: method.accountId,
          amount: '10',
          paidAt: new Date(),
        },
      }),
    );
  },
  SupplierReturn: async (p, ws) => {
    const po = await makePurchaseOrder(p, ws);
    return byId(
      await p.supplierReturn.create({
        data: {
          workspaceId: ws,
          returnNumber: `SR-${rand()}`,
          purchaseOrderId: po.id,
          supplierId: po.supplierId,
          reason: 'Damaged',
          totalAmount: '10',
          lines: [],
        },
      }),
    );
  },
  PosSession: async (p, ws) => byId(await makePosSession(p, ws)),
  CashMovement: async (p, ws) => {
    const session = await makePosSession(p, ws);
    return byId(
      await p.cashMovement.create({
        data: {
          workspaceId: ws,
          posSessionId: session.id,
          direction: 'IN',
          amount: '100',
          reason: 'Float top-up',
        },
      }),
    );
  },
  Return: async (p, ws) => byId(await makeReturn(p, ws)),
  ReturnLine: async (p, ws) => {
    const r = await makeReturn(p, ws);
    const item = await p.orderItem.create({
      data: {
        workspaceId: ws,
        orderId: r.orderId,
        lineNo: 1,
        name: 'Line',
        quantity: '1',
        listPrice: '10',
        unitPrice: '10',
        lineTotal: '10',
      },
    });
    return byId(
      await p.returnLine.create({
        data: {
          workspaceId: ws,
          returnId: r.id,
          orderItemId: item.id,
          quantity: '1',
          amount: '10',
        },
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
