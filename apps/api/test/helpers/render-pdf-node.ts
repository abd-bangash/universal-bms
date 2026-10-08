import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import ts from 'typescript';
import type { DocumentSnapshot, RenderOptions } from '../../src/modules/documents/document.types';

const run = promisify(execFile);
const root = resolve(__dirname, '../..');
let compiled: string | undefined;

/**
 * Jest cannot load @react-pdf/renderer (an ES module with top-level await), but Node can. This
 * compiles the renderer's own files once and draws documents in a plain Node process, so tests
 * exercise the real PDF output.
 */
function compileOnce(): string {
  if (compiled) return compiled;
  const out = mkdtempSync(join(tmpdir(), 'bms-render-'));
  for (const file of ['render-pdf', 'document-layout', 'format']) {
    const source = readFileSync(join(root, 'src/modules/documents', `${file}.ts`), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    writeFileSync(join(out, `${file}.js`), outputText);
  }
  mkdirSync(join(out, 'node_modules'), { recursive: true });
  writeFileSync(
    join(out, 'run.js'),
    `const { renderPdf } = require('./render-pdf');
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', async () => {
  const { snapshot, logo } = JSON.parse(input);
  const pdf = await renderPdf(snapshot, { logo: logo ? Buffer.from(logo, 'base64') : null });
  process.stdout.write(pdf.toString('base64'));
});`,
  );
  compiled = out;
  return out;
}

export async function renderInNode(
  snapshot: DocumentSnapshot,
  options: RenderOptions = {},
): Promise<Buffer> {
  const dir = compileOnce();
  const child = run('node', [join(dir, 'run.js')], {
    env: { ...process.env, NODE_PATH: join(root, 'node_modules') },
    maxBuffer: 64 * 1024 * 1024,
  });
  child.child.stdin?.end(
    JSON.stringify({ snapshot, logo: options.logo ? options.logo.toString('base64') : null }),
  );
  const { stdout } = await child;
  return Buffer.from(stdout, 'base64');
}
