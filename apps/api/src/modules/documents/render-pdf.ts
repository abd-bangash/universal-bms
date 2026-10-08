import { buildDocument } from './document-layout';
import type { DocumentSnapshot, RenderOptions } from './document.types';

/**
 * Draws a snapshot with @react-pdf/renderer. The library is published as an ES module only; Node
 * 22 loads it with require(), and it is loaded here on first use, so nothing else depends on it.
 * Kept free of framework code so it can also run on its own (see the render smoke test).
 */
export async function renderPdf(
  snapshot: DocumentSnapshot,
  options: RenderOptions = {},
): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily, see above
  const { renderToBuffer } = require('@react-pdf/renderer') as typeof import('@react-pdf/renderer');
  return renderToBuffer(buildDocument(snapshot, options));
}
