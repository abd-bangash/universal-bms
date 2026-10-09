import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * The release gate for tests (task 82): every test sub-task of Release 1 that is not marked optional
 * is done, every correctness property the task list names has a test that says so, and CI runs the
 * whole suite. If a task is ticked but its tests were never written, this is where it shows.
 */
const ROOT = resolve(__dirname, '../../..');
const tasks = readFileSync(join(ROOT, '.kiro/specs/universal-bms/tasks.md'), 'utf8').split('\n');

interface Item {
  id: string;
  text: string;
  done: boolean;
  optional: boolean;
  line: number;
}

/** Tasks and sub-tasks of Release 1 (numbers 1 to 86), as written in tasks.md. */
const items: Item[] = [];
tasks.forEach((line, i) => {
  const m = /^(\s*)- \[( |x)\] (\d+(?:\.\d+)?)(\*?)\.? (.*)$/.exec(line);
  if (!m) return;
  const id = m[3] as string;
  if (Number(id.split('.')[0]) > 86) return;
  items.push({ id, text: m[5] as string, done: m[2] === 'x', optional: m[4] === '*', line: i + 1 });
});

const files = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.next' || name.startsWith('.'))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.(spec|test|e2e-spec)\.tsx?$/.test(name)) out.push(path);
  }
  return out;
};

describe('Release 1 test coverage', () => {
  const testFiles = ['apps/api', 'apps/web', 'packages'].flatMap((d) => files(join(ROOT, d)));
  const sources = testFiles.map((f) => readFileSync(f, 'utf8'));

  it('reads the task list', () => {
    expect(items.length).toBeGreaterThan(100);
    expect(tasks.length).toBeGreaterThan(500);
  });

  it('every test sub-task of a finished task is finished, except those marked optional', () => {
    const finishedTasks = new Set(
      items.filter((i) => !i.id.includes('.') && i.done).map((i) => i.id),
    );
    const open = items
      .filter(
        (i) =>
          i.id.includes('.') &&
          finishedTasks.has(i.id.split('.')[0] as string) &&
          !i.done &&
          !i.optional,
      )
      .map((i) => `${i.id} (line ${i.line}): ${i.text.slice(0, 80)}`);
    expect(open).toEqual([]);
  });

  it('the optional ones that are still open are the ones that need a browser test runner', () => {
    const openOptional = items.filter((i) => i.optional && !i.done).map((i) => i.id);
    expect(openOptional).toEqual(['13.1']);
  });

  it('every correctness property named by a finished task has a test that names it', () => {
    const wanted = new Set<number>();
    const finished = new Set(items.filter((i) => i.done).map((i) => i.id));
    for (const item of items) {
      if (!finished.has(item.id)) continue;
      for (const m of item.text.matchAll(/Property (\d+)/g)) wanted.add(Number(m[1]));
    }
    expect(wanted.size).toBeGreaterThanOrEqual(15);
    const missing = [...wanted].filter(
      (n) => !sources.some((s) => new RegExp(`Property ${n}\\b`).test(s)),
    );
    expect(missing).toEqual([]);
  });

  it('the test suites are in CI together with lint and the type check', () => {
    const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
    for (const step of ['pnpm lint', 'pnpm typecheck', 'pnpm test'])
      expect(ci).toContain(`run: ${step}`);
    expect(ci).toMatch(/postgres/i);
    expect(ci).toMatch(/redis/i);
  });

  it('the mandatory kinds of test exist: money, stock, permissions, tenant isolation, webhooks, AI grounding', () => {
    const has = (re: RegExp) => sources.some((s) => re.test(s));
    expect(has(/Property 7\b/)).toBe(true); // money
    expect(has(/Property 3\b/)).toBe(true); // stock
    expect(has(/Property 2\b/)).toBe(true); // permissions
    expect(has(/Property 1\b/)).toBe(true); // tenant isolation
    expect(has(/Property 10\b/)).toBe(true); // webhook idempotency and ordering
    expect(has(/Property 19\b/)).toBe(true); // AI grounding
    expect(has(/Property 20\b/)).toBe(true); // AI gate
  });
});
