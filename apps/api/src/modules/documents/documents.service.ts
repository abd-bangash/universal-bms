import { Injectable } from '@nestjs/common';
import type { Customer, Invoice, Order, OrderItem } from '@prisma/client';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException, NotFoundAppException } from '../../common/errors/app.exception';
import { PrismaService, type ScopedTransaction } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../crm/timeline.service';
import { FilesService } from '../files/files.service';
import { NumberingService } from '../numbering/numbering.service';
import { json } from '../sales/line-rows';
import { OrdersService } from '../sales/orders.service';
import { QuotationsService } from '../sales/quotations.service';
import { buildQuotationSnapshot } from '../sales/quotation-snapshot';
import { SettingsService } from '../settings/settings.service';
import { DocumentRenderer } from './document-renderer';
import type { DocumentKind, DocumentPayment, DocumentSnapshot } from './document.types';
import { buildOrderSnapshot } from './snapshot.builders';
import { loadSnapshotSettings } from './snapshot-settings';

export interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  orderId: string;
  customerId: string;
  issuedAt: string;
  totalAmount: string;
  issuedById: string | null;
}

export const toInvoiceDto = (i: Invoice): InvoiceDto => ({
  id: i.id,
  invoiceNumber: i.invoiceNumber,
  orderId: i.orderId,
  customerId: i.customerId,
  issuedAt: i.issuedAt.toISOString(),
  totalAmount: i.totalAmount.toFixed(),
  issuedById: i.issuedById,
});

export interface PdfFile {
  buffer: Buffer;
  filename: string;
}

/** Issues invoices and produces the PDF of a quotation, an order confirmation or an invoice. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: DocumentRenderer,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly files: FilesService,
    private readonly orders: OrdersService,
    private readonly quotations: QuotationsService,
  ) {}

  // ── invoices (Requirement 29.3 to 29.6) ─────────────────────────────────────────────────

  /** Issues an invoice for an order on demand. An order can have several; none is ever edited. */
  async issueInvoice(user: AuthUser, orderId: string): Promise<InvoiceDto> {
    const order = await this.orders.row(user, orderId);
    const invoice = await this.prisma.scoped.$transaction((tx) =>
      this.issueInTx(tx, order.id, user.userId),
    );
    await this.timeline.record({
      customerId: order.customerId,
      orderId,
      type: 'ORDER',
      refType: 'Invoice',
      refId: invoice.id,
      summary: `Invoice ${invoice.invoiceNumber} issued`,
      actorUserId: user.userId,
    });
    return toInvoiceDto(invoice);
  }

  /**
   * Creates the invoice inside the caller's transaction: number, immutable snapshot, audit event.
   * Also used by the workflow when an order reaches the configured System_Role.
   */
  async issueInTx(
    tx: ScopedTransaction,
    orderId: string,
    issuedById: string | null,
  ): Promise<Invoice> {
    const { order, items, customer } = await this.loadOrder(tx, orderId);
    const workflow = await this.orderRole(tx, order.status);
    if (workflow === 'DRAFT' || workflow === 'CANCELLED') {
      throw new AppException('VALIDATION_FAILED', 422, 'Confirm the order before invoicing it');
    }
    if (items.length === 0) {
      throw new AppException('VALIDATION_FAILED', 422, 'The order has no lines to invoice');
    }
    const invoiceNumber = await this.numbering.next(tx, 'INVOICE');
    const at = new Date();
    const snapshot = buildOrderSnapshot({
      kind: 'INVOICE',
      number: invoiceNumber,
      at,
      order,
      items,
      customer,
      settings: await loadSnapshotSettings(this.settings),
      payments: await this.payments(),
      bankDetails: await this.bankDetails(),
    });
    const invoice = await tx.invoice.create({
      data: {
        workspaceId: order.workspaceId,
        invoiceNumber,
        orderId,
        customerId: order.customerId,
        issuedAt: at,
        totalAmount: order.totalAmount,
        data: json(snapshot),
        issuedById,
      },
    });
    await this.audit.record(tx, {
      action: 'invoice.issue',
      entityType: 'Invoice',
      entityId: invoice.id,
      after: { invoiceNumber, orderId, totalAmount: order.totalAmount.toFixed() },
    });
    return invoice;
  }

  async hasInvoice(tx: ScopedTransaction, orderId: string): Promise<boolean> {
    return (await tx.invoice.count({ where: { orderId } })) > 0;
  }

  async invoicesOf(user: AuthUser, orderId: string): Promise<InvoiceDto[]> {
    await this.orders.row(user, orderId);
    const rows = await this.prisma.scoped.invoice.findMany({
      where: { orderId },
      orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toInvoiceDto);
  }

  // ── PDFs ────────────────────────────────────────────────────────────────────────────────

  /** A sent quotation renders from the snapshot taken when it was sent; a draft from its current content. */
  async quotationPdf(id: string): Promise<PdfFile> {
    const quotation = await this.prisma.scoped.quotation.findFirst({
      where: { id },
      include: { items: true },
    });
    if (!quotation) throw new NotFoundAppException();
    let snapshot = quotation.sentSnapshot as unknown as DocumentSnapshot | null;
    if (!snapshot) {
      const [customer, lead] = await Promise.all([
        quotation.customerId
          ? this.prisma.scoped.customer.findFirst({ where: { id: quotation.customerId } })
          : null,
        quotation.leadId
          ? this.prisma.scoped.lead.findFirst({ where: { id: quotation.leadId } })
          : null,
      ]);
      snapshot = buildQuotationSnapshot({
        quotation,
        items: quotation.items,
        customer,
        lead,
        settings: await loadSnapshotSettings(this.settings),
        at: new Date(),
      });
    }
    return this.render('QUOTATION', snapshot, quotation.quotationNumber);
  }

  async orderConfirmationPdf(user: AuthUser, orderId: string): Promise<PdfFile> {
    const order = await this.orders.row(user, orderId);
    const loaded = await this.loadOrder(this.prisma.scoped, order.id);
    const snapshot = buildOrderSnapshot({
      kind: 'ORDER_CONFIRMATION',
      number: order.orderNumber,
      at: order.orderDate,
      order: loaded.order,
      items: loaded.items,
      customer: loaded.customer,
      settings: await loadSnapshotSettings(this.settings),
    });
    return this.render('ORDER_CONFIRMATION', snapshot, order.orderNumber);
  }

  async invoicePdf(user: AuthUser, invoiceId: string): Promise<PdfFile> {
    const invoice = await this.prisma.scoped.invoice.findFirst({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundAppException();
    await this.orders.row(user, invoice.orderId); // the person must be allowed to see the order
    return this.render(
      'INVOICE',
      invoice.data as unknown as DocumentSnapshot,
      invoice.invoiceNumber,
    );
  }

  // ── helpers ─────────────────────────────────────────────────────────────────────────────

  private async render(
    kind: DocumentKind,
    snapshot: DocumentSnapshot,
    number: string,
  ): Promise<PdfFile> {
    const logoId = snapshot.business.logoFileId;
    const logo = logoId ? await this.files.readBytes(logoId).catch(() => null) : null;
    const buffer = await this.renderer.render(kind, snapshot, { logo });
    return { buffer, filename: `${number.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf` };
  }

  private async loadOrder(
    tx: Pick<ScopedTransaction, 'order' | 'orderItem' | 'customer'>,
    orderId: string,
  ): Promise<{ order: Order; items: OrderItem[]; customer: Customer }> {
    const order = await tx.order.findFirst({ where: { id: orderId } });
    if (!order) throw new NotFoundAppException();
    const [items, customer] = await Promise.all([
      tx.orderItem.findMany({ where: { orderId }, orderBy: { lineNo: 'asc' } }),
      tx.customer.findFirstOrThrow({ where: { id: order.customerId } }),
    ]);
    return { order, items, customer };
  }

  private async orderRole(tx: ScopedTransaction, statusKey: string): Promise<string | null> {
    const state = await tx.workflowState.findFirst({
      where: { key: statusKey, workflow: { entityType: 'ORDER' } },
    });
    return state?.systemRole ?? null;
  }

  /** Confirmed payments are listed once the finance module exists (task 40). */
  private async payments(): Promise<DocumentPayment[]> {
    return [];
  }

  /** The customer-facing bank accounts are listed once the finance module exists (task 39). */
  private async bankDetails(): Promise<unknown> {
    return null;
  }
}
