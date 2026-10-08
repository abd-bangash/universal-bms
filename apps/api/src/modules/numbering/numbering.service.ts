import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { DocumentType, NumberingFormat } from '@bms/types';
import { ClsService } from 'nestjs-cls';
import type { RequestContext } from '../../common/context/request-context';
import type { ScopedTransaction } from '../../common/prisma/prisma.service';
import { workspaceConfigSchema } from '@bms/validators';

/** `QT-2026-0004`: prefix, the year when configured, and the counter zero-padded (Requirement 23.5). */
export function formatDocumentNumber(
  format: NumberingFormat,
  year: number,
  counter: number,
): string {
  const padding = Number.isInteger(format.padding) && format.padding > 0 ? format.padding : 1;
  return `${format.prefix}${format.includeYear ? `${year}-` : ''}${String(counter).padStart(padding, '0')}`;
}

/** The calendar year in a timezone, so a sale at 00:30 on 1 January local time belongs to the new year. */
export function yearIn(timeZone: string, at: Date): number {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric' }).format(at));
}

/**
 * Document numbers that are unique and gap-free per type and workspace (Requirement 54.5). The
 * counter row is incremented by one atomic statement inside the caller's transaction, so the row
 * stays locked until that transaction ends: two documents never get one number, and a document
 * whose transaction rolls back gives its number back.
 */
@Injectable()
export class NumberingService {
  constructor(private readonly cls: ClsService<RequestContext>) {}

  async next(tx: ScopedTransaction, docType: DocumentType, at: Date = new Date()): Promise<string> {
    const workspaceId = this.cls.get('workspaceId');
    if (!workspaceId) throw new Error('No workspace in context');
    // Read the format on the caller's own connection: asking the settings service would need a
    // second one, and many documents in flight could then all wait for each other's connections.
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { config: true },
    });
    const config = workspaceConfigSchema.parse(workspace.config);
    const format = config.numbering[docType] as NumberingFormat;
    const timeZone = config.locale.timezone;
    const year = format.includeYear ? yearIn(timeZone, at) : 0;

    const rows = await tx.$queryRaw<Array<{ issued: number }>>`
      INSERT INTO document_sequences (id, workspace_id, doc_type, year, next_value)
      VALUES (${randomUUID()}, ${workspaceId}, ${docType}::"document_type", ${year}, 2)
      ON CONFLICT (workspace_id, doc_type, year)
      DO UPDATE SET next_value = document_sequences.next_value + 1
      RETURNING next_value - 1 AS issued`;
    const issued = rows[0]?.issued;
    if (issued === undefined) throw new Error('Could not issue a document number');
    return formatDocumentNumber(format, yearIn(timeZone, at), Number(issued));
  }
}
