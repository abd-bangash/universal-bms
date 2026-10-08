import { Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CrmModule } from '../crm/crm.module';
import { FileReferenceRegistry } from '../files/file-reference.registry';
import { SalesModule } from '../sales/sales.module';
import { SettingsService } from '../settings/settings.service';
import { WorkflowRegistry } from '../workflows/workflow.registry';
import { DocumentRenderer, ReactPdfRenderer } from './document-renderer';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/** Quotation, order confirmation and invoice PDFs; invoice issuing (task 36). */
@Module({
  imports: [SalesModule, CrmModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, { provide: DocumentRenderer, useClass: ReactPdfRenderer }],
  exports: [DocumentsService, DocumentRenderer],
})
export class DocumentsModule implements OnModuleInit {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly documents: DocumentsService,
    private readonly settings: SettingsService,
    private readonly references: FileReferenceRegistry,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit(): void {
    // The invoice is raised automatically when an order reaches the configured System_Role (29.3)
    for (const role of ['DELIVERED', 'COMPLETED'] as const) {
      this.registry.registerSideEffect('ORDER', role, async ({ tx, record, actor }) => {
        const configured = await this.settings.get<string | null | undefined>(
          'documents.autoInvoiceOnSystemRole',
        );
        if (configured !== role || (await this.documents.hasInvoice(tx, record.id))) return;
        await this.documents.issueInTx(tx, record.id, actor.userId);
      });
    }
    // A logo that an issued invoice or a sent quotation shows cannot be deleted (34.8)
    this.references.register('documents', async (fileId) => {
      const rows = await this.prisma.scoped.$queryRaw<Array<{ one: number }>>`
        SELECT 1 AS one FROM invoices WHERE data->'business'->>'logoFileId' = ${fileId}
        UNION ALL
        SELECT 1 FROM quotations WHERE sent_snapshot->'business'->>'logoFileId' = ${fileId}
        LIMIT 1`;
      return rows.length > 0;
    });
  }
}
