# Technology

## Stack

- Monorepo: pnpm workspaces, Turborepo, TypeScript `strict`
- Web: Next.js App Router, Tailwind CSS, shadcn/ui, TanStack Query, react-hook-form, Zod, next-intl
- API: NestJS, REST under `/api/v1`, class-validator DTOs, Swagger
- Data: PostgreSQL, Prisma 5 or later, `decimal.js`
- Jobs: BullMQ on Redis, `@nestjs/schedule`
- Files: S3-compatible storage (MinIO locally)
- PDFs: `@react-pdf/renderer`
- Tests: Jest, supertest against real PostgreSQL, fast-check, Playwright

## Commands

```
pnpm install
docker compose up -d            # postgres, redis, minio
pnpm --filter api prisma migrate dev
pnpm --filter api seed:demo
pnpm dev                        # web on 3000, api on 4000
pnpm lint && pnpm typecheck && pnpm test
```

## Conventions

- **Tenant scoping**: business code uses only `prisma.scoped`. Every tenant table has a required `workspaceId`. Never read the workspace from a request body or query.
- **Money and quantities**: `Decimal` in the database, `decimal.js` in code, strings in JSON. Never `number` arithmetic.
- **Calculations**: pricing, tax, rounding, commission and field visibility live in `packages/calc` as pure functions used by both apps. Do not re-implement them in a service or a component.
- **Status changes**: only through `WorkflowService.transition`. Behaviour depends on `systemRole`, never on a label.
- **Stock changes**: only through `InventoryService.post`, `reserve`, `release`, `fulfil`.
- **Audit**: every state-changing service method calls `AuditService.record(tx, …)` inside its transaction.
- **Transactions**: any operation writing more than one record uses `prisma.$transaction`.
- **Events**: publish through `DomainEventBus` after commit. Modules never call each other's repositories.
- **Permissions**: every non-public route has `@RequirePermission('resource:action')` from the catalogue in `packages/types`.
- **Errors**: throw typed exceptions with a `code` from the table in `design.md`. Never return provider errors or stack traces.
- **External calls**: only through an adapter, wrapped by `AdapterRunner.run`.
- **Web data access**: only through the BFF and the typed API client. No tokens or business data in `localStorage`.
- **Custom fields in forms**: always the shared `DynamicFields` component.
- **Text**: every user-visible string goes through next-intl and `useTerminology`.
- **Migrations**: one per schema task, each with a reviewed `rollback.sql`.
- **Tests**: tests for money, stock, permissions and tenant isolation are mandatory for a task to be done.
- **Secrets**: environment variables for platform secrets; encrypted `IntegrationConnection` for per-workspace secrets. Nothing in the repository or logs.

## Do Not

- Do not use Prisma `$use` middleware, a materialized view for stock, or EAV attribute tables. `design.md` replaced all three.
- Do not add a library, table, endpoint or environment variable that `design.md` does not name without asking first.
- Do not implement tasks of a later release, even partially, while working on an earlier one.
