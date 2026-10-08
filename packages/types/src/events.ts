/** Fields every Domain_Event carries. Payloads hold entity ids only; listeners load what they need. */
export interface DomainEventBase {
  workspaceId: string;
  actorUserId: string | null;
  occurredAt: string;
}

/** Events of design.md "Domain Events": name -> payload (entity ids on top of the base). */
export interface DomainEventMap {
  'lead.created': { leadId: string };
  'lead.assigned': { leadId: string; assignedToId: string | null };
  'lead.status_changed': { leadId: string };
  'customer.created': { customerId: string };
  'customer.merged': { survivorId: string; mergedId: string };
  'conversation.message_received': { conversationId: string; messageId: string };
  'conversation.message_sent': { conversationId: string; messageId: string };
  'conversation.message_status': { conversationId: string; messageId: string };
  'quotation.sent': { quotationId: string };
  'quotation.accepted': { quotationId: string };
  'quotation.expired': { quotationId: string };
  'order.created': { orderId: string };
  'order.status_changed': { orderId: string };
  'payment.confirmed': { paymentId: string; orderId: string | null; customerId: string | null };
  'payment.voided': { paymentId: string; orderId: string | null; customerId: string | null };
  'payment.refunded': { paymentId: string; orderId: string | null; customerId: string | null };
  'stock.low': { variantId: string; locationId: string };
  'stock.movement_posted': { movementIds: string[] };
  'purchase.received': { purchaseOrderId: string; goodsReceiptId: string };
  'task.due': { taskId: string };
  'approval.requested': { approvalRequestId: string };
  'approval.decided': { approvalRequestId: string };
  'integration.failed': { connectionId: string };
  'ai.escalated': { conversationId: string };
  'ai.suggestion_created': { suggestionId: string; conversationId: string | null };
  'import.finished': { importJobId: string };
}

export type DomainEventName = keyof DomainEventMap;

export type DomainEventPayload<N extends DomainEventName = DomainEventName> = DomainEventBase &
  DomainEventMap[N];

/** Runtime list, so tests and registries can enumerate every event name. */
export const DOMAIN_EVENT_NAMES = [
  'lead.created',
  'lead.assigned',
  'lead.status_changed',
  'customer.created',
  'customer.merged',
  'conversation.message_received',
  'conversation.message_sent',
  'conversation.message_status',
  'quotation.sent',
  'quotation.accepted',
  'quotation.expired',
  'order.created',
  'order.status_changed',
  'payment.confirmed',
  'payment.voided',
  'payment.refunded',
  'stock.low',
  'stock.movement_posted',
  'purchase.received',
  'task.due',
  'approval.requested',
  'approval.decided',
  'integration.failed',
  'ai.escalated',
  'ai.suggestion_created',
  'import.finished',
] as const satisfies readonly DomainEventName[];
