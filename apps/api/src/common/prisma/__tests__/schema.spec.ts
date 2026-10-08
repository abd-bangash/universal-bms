import { readFileSync } from 'node:fs';
import { GLOBAL_MODELS, TENANT_MODELS } from '../tenant-models';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS script shared with the CLI
const generator = require('../../../../scripts/generate-tenant-models.cjs') as {
  parseModels(source: string): Array<{
    name: string;
    fields: Array<{ name: string; line: string }>;
    attributes: string[];
  }>;
  generate(): string;
  SCHEMA: string;
  OUTPUT: string;
};

const models = generator.parseModels(readFileSync(generator.SCHEMA, 'utf8'));
const hasWorkspaceId = (m: (typeof models)[number]) =>
  m.fields.some((f) => f.name === 'workspaceId');

describe('schema rules', () => {
  it('parses a sample schema', () => {
    const sample = generator.parseModels(
      'model A {\n  id String @id @default(cuid())\n  workspaceId String // tenant\n  @@unique([workspaceId, sku])\n}\n',
    );
    expect(sample).toHaveLength(1);
    expect(sample[0]?.fields.map((f) => f.name)).toEqual(['id', 'workspaceId']);
    expect(sample[0]?.attributes).toEqual(['@@unique([workspaceId, sku])']);
  });

  it('every model has a workspaceId unless it is listed in GLOBAL_MODELS', () => {
    const offenders = models.filter((m) => !hasWorkspaceId(m) && !GLOBAL_MODELS.has(m.name));
    expect(offenders.map((m) => m.name)).toEqual([]);
  });

  it('GLOBAL_MODELS never contain a workspaceId column', () => {
    const offenders = models.filter((m) => hasWorkspaceId(m) && GLOBAL_MODELS.has(m.name));
    expect(offenders.map((m) => m.name)).toEqual([]);
  });

  it('TENANT_MODELS is the generated list and the generated file is up to date', () => {
    expect(readFileSync(generator.OUTPUT, 'utf8')).toBe(generator.generate());
    expect([...TENANT_MODELS].sort()).toEqual(
      models
        .filter(hasWorkspaceId)
        .map((m) => m.name)
        .sort(),
    );
  });

  it('every primary key is a cuid string (no sequential identifiers, requirement 54.9)', () => {
    const offenders = models.filter((m) => {
      const id = m.fields.find((f) => f.name === 'id');
      return id && !/^id\s+String\s+@id\s+@default\(cuid\(\)\)/.test(id.line);
    });
    expect(offenders.map((m) => m.name)).toEqual([]);
  });

  it('tenant models are unique per workspace only (design D3)', () => {
    const offenders = models
      .filter(hasWorkspaceId)
      .filter(
        (m) =>
          m.fields.some((f) => /\s@unique\b/.test(f.line)) ||
          m.attributes.some((a) => a.startsWith('@@unique') && !a.includes('workspaceId')),
      );
    expect(offenders.map((m) => m.name)).toEqual([]);
  });
});
