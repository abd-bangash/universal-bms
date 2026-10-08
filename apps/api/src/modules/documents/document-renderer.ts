import { Injectable } from '@nestjs/common';
import type {
  DocumentKind,
  DocumentSnapshot,
  ReceiptData,
  ReceiptRenderOptions,
  RenderOptions,
} from './document.types';
import { renderPdf, renderReceiptPdf } from './render-pdf';

/** Turns a snapshot into a file. R1 has one implementation; right-to-left locales may add another (D18). */
export abstract class DocumentRenderer {
  abstract render(
    type: DocumentKind,
    snapshot: DocumentSnapshot,
    options?: RenderOptions,
  ): Promise<Buffer>;
  abstract renderReceipt(data: ReceiptData, options: ReceiptRenderOptions): Promise<Buffer>;
}

@Injectable()
export class ReactPdfRenderer extends DocumentRenderer {
  render(type: DocumentKind, snapshot: DocumentSnapshot, options: RenderOptions = {}) {
    return renderPdf({ ...snapshot, type }, options);
  }

  renderReceipt(data: ReceiptData, options: ReceiptRenderOptions) {
    return renderReceiptPdf(data, options);
  }
}
