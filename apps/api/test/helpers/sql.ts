import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';

/** Splits a SQL script into statements, ignoring semicolons inside $$ bodies and comments. */
export function splitSql(script: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollar = false;
  const lines = script.split('\n');
  for (const line of lines) {
    const code = line.replace(/--.*$/, '');
    if (!code.trim() && !inDollar) continue;
    current += `${line}\n`;
    if ((code.match(/\$\$/g) ?? []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && code.trimEnd().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

export function migrationFile(name: string, file: 'migration.sql' | 'rollback.sql'): string {
  return readFileSync(resolve(__dirname, '../../prisma/migrations', name, file), 'utf8');
}

export async function runScript(prisma: PrismaClient, script: string): Promise<void> {
  for (const statement of splitSql(script)) await prisma.$executeRawUnsafe(statement);
}
