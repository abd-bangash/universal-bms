import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TenantsService } from '../modules/tenants/tenants.service';
import { IndustryProfileService } from '../modules/tenants/industry-profile.service';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/**
 * Release 1 way to create a business:
 *   node dist/cli/workspace-create.js --name "Acme Furniture" --owner-email owner@acme.test \
 *     --owner-first Ada --owner-last Owner [--profile furniture] [--password ...] [--currency PKR] [--timezone Asia/Karachi]
 * Without --password a random one is generated and printed once.
 */
async function main(): Promise<void> {
  const name = arg('name');
  const email = arg('owner-email');
  if (!name || !email) {
    console.error(
      'Usage: workspace-create --name <name> --owner-email <email> [--owner-first <n>] [--owner-last <n>] [--profile <key>] [--password <pw>] [--currency <ISO>] [--timezone <tz>]',
    );
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    await app.get(IndustryProfileService).syncBuiltIn();
    const password = arg('password') ?? randomBytes(12).toString('base64url');
    const created = await app.get(TenantsService).createWorkspace({
      name,
      industryProfile: arg('profile') ?? 'furniture',
      owner: {
        email,
        firstName: arg('owner-first') ?? 'Owner',
        lastName: arg('owner-last') ?? 'Account',
        password,
      },
      currency: arg('currency'),
      timezone: arg('timezone'),
    });
    console.log(
      JSON.stringify(
        {
          ...created,
          ownerEmail: email,
          ...(arg('password') ? {} : { generatedPassword: password }),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
