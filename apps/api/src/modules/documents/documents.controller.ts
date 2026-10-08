import { Controller, Get, Param, Post, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SkipEnvelope } from '../../common/decorators/skip-envelope.decorator';
import { DocumentsService, type PdfFile } from './documents.service';

class IdParam {
  @IsString() id!: string;
}

/** The browser opens its own viewer, with the print dialog one click away (design.md, Documents). */
function inline(res: Response, file: PdfFile): StreamableFile {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${file.filename}"`,
    'Cache-Control': 'private, no-store',
  });
  return new StreamableFile(file.buffer);
}

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Post('orders/:id/invoice')
  @RequirePermission('order:edit')
  issue(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.documents.issueInvoice(user, p.id);
  }

  @Get('orders/:id/invoices')
  @RequirePermission('order:view')
  invoices(@CurrentUser() user: AuthUser, @Param() p: IdParam) {
    return this.documents.invoicesOf(user, p.id);
  }

  @Get('quotations/:id/pdf')
  @RequirePermission('quotation:view')
  @SkipEnvelope()
  async quotation(@Param() p: IdParam, @Res({ passthrough: true }) res: Response) {
    return inline(res, await this.documents.quotationPdf(p.id));
  }

  @Get('orders/:id/pdf')
  @RequirePermission('order:view')
  @SkipEnvelope()
  async confirmation(
    @CurrentUser() user: AuthUser,
    @Param() p: IdParam,
    @Res({ passthrough: true }) res: Response,
  ) {
    return inline(res, await this.documents.orderConfirmationPdf(user, p.id));
  }

  @Get('invoices/:id/pdf')
  @RequirePermission('order:view')
  @SkipEnvelope()
  async invoice(
    @CurrentUser() user: AuthUser,
    @Param() p: IdParam,
    @Res({ passthrough: true }) res: Response,
  ) {
    return inline(res, await this.documents.invoicePdf(user, p.id));
  }
}
