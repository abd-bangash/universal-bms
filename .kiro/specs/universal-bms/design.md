# Design Document — Universal Business Management & AI Automation System

## Overview

The Universal BMS is a multi-tenant business operating system built on **Next.js (App Router) + NestJS + PostgreSQL + Prisma + TypeScript**, with **BullMQ on Redis** for background jobs. One codebase serves every industry: industry behaviour comes from an Industry Profile, Field_Definitions, Workflows, terminology and templates, never from industry-specific code.

- **Frontend** (`apps/web`): Next.js App Router. Talks only to the NestJS API, through its own server-side route handlers (a backend-for-frontend) that hold the session cookies.
- **Backend API** (`apps/api`): NestJS modular monolith. One feature module per domain. All business logic, authorization and data access live here.
- **Database**: one PostgreSQL database per environment. Schema changes only through Prisma migrations. Tenant isolation through a Prisma Client extension, with PostgreSQL row-level security added as a second layer in R4.
- **Background jobs**: BullMQ + Redis for webhook processing, AI calls, automation, imports, exports and scheduled work.
- **Shared packages** (`packages/*`): types, validators and pure calculation functions used by both apps.

This document is binding. Where it names a library, a table, a field, an endpoint or a rule, implement exactly that. Where something is not stated here or in `requirements.md`, stop and ask; do not assume.

### Releases

The system is delivered in four releases. `tasks.md` tags every task with its release; `release-plan.md` maps R1 to the 15 working days.

| Release | Content |
|---|---|
| R1 | Furniture business first release: foundation, catalog, CRM, quotations and orders, payments, inventory, POS with PDF receipts, purchasing, commissions and activity log, dashboard and reports, WhatsApp inbox, AI in `ASSIST` mode, tested on the testing environment |
| R2 | Automation engine, notification preferences and email, provider templates and consent, Facebook Lead Ads, Instagram, AI `AUTO_REPLY`, question flows and knowledge base |
| R3 | Returns and refunds, split payments and sessions with closing, multi-location, stock counts, batch/serial, approvals, production and delivery, price lists, bundles, advanced commissions, payables, imports, thermal text output |
| R4 | Field builder, workflow editor, terminology and template editors, further industry profiles, onboarding and platform admin, report builder, row-level security, load and security testing, privacy tools, production deployment, handover |

R1 builds the **data model and engines for all releases** (tenant scoping, Field_Definitions, Workflows, adapters). Later releases add screens and behaviour on top; they must not require restructuring R1 tables.

---

## Binding Design Decisions

These settle points that the earlier draft left open or contradictory.

| # | Decision | Reason |
|---|---|---|
| D1 | The tenant column is named `workspaceId` on every tenant-scoped table. "tenantId" is only a word for its value. | The earlier draft used both names; the scoping code and the schema did not match. |
| D2 | Tenant scoping uses a **Prisma Client extension** (`$extends`) plus `nestjs-cls` (AsyncLocalStorage). Prisma `$use` middleware is not used. Prisma 5 or later is required. | `$use` is deprecated, and the earlier snippet missed `updateMany`, `deleteMany`, `upsert`, `aggregate`, `groupBy` and `createMany`. |
| D3 | Every tenant-scoped table has a required `workspaceId`, including child tables (order lines, variants, history rows). Uniqueness is always per workspace (`@@unique([workspaceId, sku])`). | The earlier schema had `sku @unique` globally, which would stop two businesses using the same SKU, and child tables with no tenant column. |
| D4 | Stock on hand is the sum of the `StockMovement` ledger. **Reservations are a separate `StockReservation` table**, not ledger rows. `StockLevel` is a maintained projection (on hand, reserved, average cost) updated in the same transaction and row-locked. No materialized view. | The earlier draft put reservations in the ledger while also defining stock as the ledger sum, which contradict each other; a 5-minute materialized view would also show stale stock at POS. |
| D5 | Custom fields use **one mechanism for all entities**: `FieldDefinition` rows plus a validated `customFields` JSONB column on each entity. The earlier `AttributeSchema` / `AttributeValue` tables are replaced by this. | The source specification requires custom fields on any entity, not only products. One mechanism avoids two parallel engines. |
| D6 | Statuses are data: `Workflow`, `WorkflowState`, `WorkflowTransition`. Built-in behaviour hangs on `WorkflowState.systemRole`, never on a label. Records store the state `key` in a string column. | The business must be able to rename and add statuses without breaking stock reservation or commissions. |
| D7 | `Order.paidAmount` and `Order.balanceDue` are **stored** and updated in the same transaction as every Payment change. Only `CONFIRMED` payments count. A property test proves they always equal the recomputed value. | The earlier draft said both "computed" and "stored". |
| D8 | Money and quantities are `Decimal(18,4)` in PostgreSQL and `decimal.js` in code, serialized as strings in JSON. No JavaScript `number` arithmetic on money or stock. | Floating point errors in totals. |
| D9 | Audit rows are written by services inside the same transaction as the change, with before and after values. A database trigger rejects UPDATE and DELETE on `audit_events`. | A controller-level interceptor cannot know the previous state and cannot be transactional. |
| D10 | Injection protection is parameterized queries plus type validation. Inputs are **not** rejected for containing characters such as `'` or `--`. The earlier "Property 13" is replaced. | Rejecting those characters breaks real names and notes ("O'Brien") and adds no protection. |
| D11 | The AI adapter exposes two provider-neutral methods (`generateStructured`, `generateText`). Prompts, context building, validation and the business functions live once in `AIService`. | The earlier interface would duplicate every prompt in every provider adapter. |
| D12 | The web app keeps tokens in HTTP-only cookies set by Next.js route handlers; the browser never sees a token. The Next.js server calls the API with `Authorization: Bearer`. | The earlier draft said both "Bearer token" and "httpOnly cookie" without saying how they fit. |
| D13 | Documents are PDFs rendered server-side with `@react-pdf/renderer`. Receipts have 58mm, 80mm and A4 layouts and are printed with the browser's print function. ESC/POS text output is an R3 driver behind `PrintOutputAdapter`. | Agreed with the client: PDF plus print works on any installed printer. |
| D14 | Domain events go through a `DomainEventBus` interface. R1 implementation: in-process, dispatched after the transaction commits. R2 implementation: transactional outbox table relayed to BullMQ. Callers do not change. | Lets R1 ship without Redis-dependent eventing while keeping a reliable path for automation. |
| D15 | Redis and BullMQ are introduced in R1 at the messaging phase. Before that, scheduled work uses `@nestjs/schedule`. On the testing environment workers run inside the API process (`WORKERS_IN_PROCESS=true`). | Keeps the testing environment to one API service. |
| D16 | Tests for money, stock, permissions and tenant isolation are mandatory, not optional (`*`) tasks. | Requirement 53.7. |
| D17 | Validation: API request DTOs use `class-validator`. `packages/validators` holds Zod schemas for configuration, custom fields and web forms. | Keeps Requirement 20.2 while sharing rules with the web app. |
| D18 | Right-to-left PDF output with `@react-pdf/renderer` must be proven in a spike before any Arabic or Urdu locale is promised. If shaping is wrong, that locale's documents switch to an HTML-to-PDF renderer behind the same `DocumentRenderer` interface. | RTL shaping in that library is a known risk and must not be assumed. |

---

## Architecture

### System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Browser (desktop / phone)                    │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ HTTPS, HTTP-only session cookies
┌──────────────────────────▼───────────────────────────────────────────┐
│                 Next.js App Router (apps/web)                        │
│  Pages + /api/bff/* route handlers (cookie ⇄ Bearer, refresh)        │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ REST / JSON, Authorization: Bearer
┌──────────────────────────▼───────────────────────────────────────────┐
│                     NestJS API (apps/api)                            │
│  RequestId → Throttler → JwtAuthGuard → WorkspaceContext (cls)       │
│  → ModuleEnabledGuard → PermissionGuard → ValidationPipe → handler   │
│                                                                      │
│  auth · tenants · users · settings · fields · workflows · audit      │
│  files · catalog · inventory · purchasing · crm · tasks · search     │
│  orders · production · documents · pos · payments · commissions      │
│  channels · integrations · ai · automation · notifications           │
│  reporting · imports · platform · health                             │
└───────┬───────────────────────┬──────────────────────┬───────────────┘
        │ Prisma (scoped client)│ BullMQ               │ Adapters
┌───────▼──────────┐   ┌────────▼─────────┐   ┌────────▼───────────────┐
│   PostgreSQL     │   │      Redis       │   │ Channel: WhatsApp,     │
│                  │   │ queues + cache   │   │  Facebook, Instagram   │
└──────────────────┘   └──────────────────┘   │ AI: provider of choice │
                                              │ Storage: S3-compatible │
   Inbound webhooks ──► POST /api/v1/webhooks/:provider                │
                                              │ Email: SMTP            │
                                              │ Print output: PDF      │
                                              └────────────────────────┘
```

### Monorepo Structure

```
universal-bms/
├── .kiro/
│   ├── steering/                     # product.md, tech.md, structure.md
│   └── specs/universal-bms/          # requirements.md, design.md, tasks.md, release-plan.md, traceability.md
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── (auth)/               # /login, /invite/[token], /reset-password, /select-workspace
│   │   │   ├── (app)/                # authenticated shell (sidebar, header, search, notifications)
│   │   │   │   ├── page.tsx          # /            Home dashboard
│   │   │   │   ├── customers/        # /customers, /customers/[id]
│   │   │   │   ├── leads/            # /leads (pipeline + list), /leads/[id]
│   │   │   │   ├── conversations/    # /conversations, /conversations/[id]
│   │   │   │   ├── tasks/            # /tasks
│   │   │   │   ├── quotations/       # /quotations, /quotations/new, /quotations/[id]
│   │   │   │   ├── orders/           # /orders, /orders/new, /orders/[id]
│   │   │   │   ├── returns/          # /returns                         (R3)
│   │   │   │   ├── production/       # /production                      (R3)
│   │   │   │   ├── pos/              # /pos, /pos/sessions, /pos/receipts
│   │   │   │   ├── products/         # /products, /products/[id], /products/categories, /products/brands
│   │   │   │   ├── inventory/        # /inventory, /inventory/movements, /inventory/locations, /inventory/adjust
│   │   │   │   ├── purchasing/       # /purchasing/suppliers, /purchasing/orders, /purchasing/orders/[id]
│   │   │   │   ├── finance/          # /finance/payments, /finance/expenses, /finance/receivables, /finance/accounts
│   │   │   │   ├── staff/            # /staff, /staff/roles, /staff/commissions, /staff/performance
│   │   │   │   ├── automation/       # /automation/ai, /automation/rules, /automation/templates
│   │   │   │   ├── integrations/     # /integrations
│   │   │   │   ├── reports/          # /reports, /reports/[type]
│   │   │   │   └── settings/         # /settings/business, /industry, /fields, /workflows, /documents, /audit, /system
│   │   │   └── api/bff/[...path]/route.ts   # proxy to API; sets and refreshes cookies
│   │   ├── components/               # ui/ (shadcn), data-table/, forms/, dynamic-fields/, layout/
│   │   ├── lib/                      # api client, permissions, terminology, formatters, query keys
│   │   ├── messages/                 # en.json (translation layer)
│   │   └── middleware.ts             # redirects unauthenticated requests to /login
│   └── api/
│       ├── src/
│       │   ├── main.ts
│       │   ├── app.module.ts
│       │   ├── config/               # env schema and typed config
│       │   ├── common/
│       │   │   ├── guards/           # JwtAuthGuard, PermissionGuard, ModuleEnabledGuard, PlatformAdminGuard
│       │   │   ├── decorators/       # @CurrentUser, @RequirePermission, @Public, @RequireModule, @Idempotent
│       │   │   ├── interceptors/     # ResponseEnvelope, Idempotency, Logging
│       │   │   ├── filters/          # AllExceptionsFilter
│       │   │   ├── pipes/            # ValidationPipe config
│       │   │   ├── context/          # WorkspaceContext (nestjs-cls)
│       │   │   ├── prisma/           # PrismaService, tenant extension, TENANT_MODELS
│       │   │   ├── events/           # DomainEventBus, event names, payload types
│       │   │   ├── money/            # decimal helpers
│       │   │   └── pagination/
│       │   ├── modules/<domain>/     # controller(s), service(s), dto/, <domain>.module.ts, __tests__/
│       │   └── jobs/                 # BullMQ processors and schedulers
│       ├── prisma/
│       │   ├── schema.prisma
│       │   ├── migrations/           # each with migration.sql and rollback.sql
│       │   └── seed/                 # system defaults, industry profiles, demo dataset
│       └── test/                     # integration and end-to-end tests (supertest)
├── packages/
│   ├── types/                        # entity types, API contracts, adapter interfaces, event payloads
│   ├── validators/                   # Zod: workspace config, field values, visibility conditions, forms
│   ├── calc/                         # pure functions: pricing, tax, rounding, commission, visibility evaluator
│   └── config/                       # shared ESLint, TypeScript, Prettier
├── docs/                             # admin guide, user guide, deployment, api, ai-data-handling, integrations
├── docker-compose.yml                # development: postgres, redis, minio
└── deploy/                           # render.yaml (testing), compose.prod.yml + Caddyfile (production)
```

Route groups in parentheses do not appear in URLs. Every page in `(app)` is under the authenticated shell.

### Technology Choices

| Concern | Choice |
|---|---|
| Runtime and package manager | Node.js LTS, pnpm workspaces, Turborepo |
| Language | TypeScript, `strict: true`, no `any` without a comment explaining why |
| API | NestJS, REST, `class-validator` / `class-transformer`, `@nestjs/swagger` for OpenAPI |
| ORM and database | Prisma 5 or later, PostgreSQL 15 or later, extensions `pg_trgm` and `citext` |
| Request context | `nestjs-cls` |
| Auth | `@nestjs/passport`, `passport-jwt`, RS256 access tokens, `argon2` password hashing |
| Jobs and cache | BullMQ, Redis, `@nestjs/schedule` |
| Events | `@nestjs/event-emitter` behind `DomainEventBus` |
| Decimals | `decimal.js` (Prisma `Decimal`) |
| Files | S3-compatible client; MinIO in development; `sharp` for thumbnails; `file-type` for content sniffing |
| PDFs | `@react-pdf/renderer` |
| Web UI | Next.js App Router, Tailwind CSS, shadcn/ui, TanStack Query, react-hook-form + Zod, `next-intl` |
| Tests | Jest (API unit and integration with supertest against a real PostgreSQL), `fast-check` for properties, Playwright for web end-to-end |
| Resilience | `cockatiel` (timeouts, retries, circuit breakers) around every adapter call |
| Logging | `pino` with redaction |

Exact versions are pinned in `package.json` when the repository is scaffolded and are not upgraded mid-release.

---

## Cross-Cutting Mechanisms

### 1. Workspace Context and Tenant Scoping

1. `JwtAuthGuard` validates the access token and attaches `{ userId, workspaceId, membershipId, permissions, permVersion }`.
2. A `ClsModule` middleware stores `workspaceId` and `userId` in the request's AsyncLocalStorage context. Job processors set the same context from the job payload before doing any work.
3. `PrismaService` exposes two clients:
   - `prisma.scoped` — the extended client. **All business modules use only this.**
   - `prisma.unscoped` — the raw client. Allowed only in: `auth` (login before a workspace is known), `tenants` (creating a workspace), `platform`, webhook workspace resolution, and seeds. An ESLint rule forbids importing it elsewhere.
4. The extension, for every model listed in `TENANT_MODELS`:

```typescript
// apps/api/src/common/prisma/tenant.extension.ts
const READ_WRITE_WHERE = ['findFirst','findFirstOrThrow','findMany','findUnique','findUniqueOrThrow',
  'update','updateMany','delete','deleteMany','count','aggregate','groupBy'];

export const tenantExtension = (cls: ClsService) => Prisma.defineExtension({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!TENANT_MODELS.has(model)) return query(args);
        const workspaceId = cls.get('workspaceId');
        if (!workspaceId) throw new MissingWorkspaceContextError(model, operation);

        if (READ_WRITE_WHERE.includes(operation)) {
          args.where = { ...(args.where ?? {}), workspaceId };
        } else if (operation === 'create') {
          args.data = { ...args.data, workspaceId };
        } else if (operation === 'createMany') {
          args.data = [args.data].flat().map((d) => ({ ...d, workspaceId }));
        } else if (operation === 'upsert') {
          args.where = { ...args.where, workspaceId };
          args.create = { ...args.create, workspaceId };
        }
        return query(args);
      },
    },
  },
});
```

5. Rules that the extension cannot enforce and code review plus tests must:
   - Nested writes (`create: { items: { create: [...] } }`) must set `workspaceId` on every nested row. Because the column is required with no default, forgetting it is a TypeScript error.
   - Raw SQL (`$queryRaw`) is allowed only in `reporting` and `search`, must take `workspaceId` as a bound parameter, and each raw query has a tenant-isolation test.
   - A record of another workspace is reported as **404**, never 403, so its existence is not revealed. An attempt that is detectably cross-tenant (an id supplied in a body that resolves to another workspace) is rejected with 403 and audited (Requirement 1.4).
6. `TENANT_MODELS` is generated by a script that reads `schema.prisma` and lists every model that has a `workspaceId` field. A unit test fails if a model lacks `workspaceId` and is not in the explicit `GLOBAL_MODELS` allow-list (`User`, `UserSession`, `PasswordResetToken`, `IndustryProfile`, `PlatformSetting`).
7. **R4 second layer:** PostgreSQL row-level security. Every tenant table gets `ENABLE ROW LEVEL SECURITY` and a policy `USING (workspace_id = current_setting('app.workspace_id', true))`. The scoped client then runs each request's queries in a transaction that first executes `SELECT set_config('app.workspace_id', $1, true)`. The application's database role is not the table owner and has no `BYPASSRLS`.

### 2. Authentication, Sessions and Permissions

- **Access token**: RS256 JWT, 15 minutes. Payload `{ sub: userId, tenantId: workspaceId, mid: membershipId, permissions: string[], pv: permVersion, iat, exp }`.
- **Refresh token**: opaque random 256-bit value, 30 days, stored as a SHA-256 hash in `UserSession`, rotated on every use. Re-use of an already-rotated token revokes the whole session family and is audited.
- **Permission freshness**: `UserWorkspace.permVersion` increments when the member's roles change or any of their roles' permissions change. `PermissionGuard` compares the token's `pv` with the current value (cached in memory for 30 seconds, in Redis once available). A mismatch returns 401 with code `TOKEN_STALE`; the BFF refreshes silently. This satisfies the 60-second rule.
- **Deactivation**: sets membership status `INACTIVE`, revokes all sessions, bumps `permVersion`.
- **Lockout**: failed logins counted per account in `LoginAttempt`; 5 failures in 15 minutes lock for 15 minutes.
- **Passwords**: `argon2id`; minimum 10 characters; not equal to the email.
- **Workspace selection**: `POST /auth/login` returns the user's memberships when there is more than one; `POST /auth/select-workspace` issues tokens for the chosen one; `POST /auth/switch-workspace` does the same from an existing session.
- **Web session**: the BFF route `app/api/bff/[...path]/route.ts` receives browser requests, reads the `bms_at` and `bms_rt` cookies (HTTP-only, Secure, SameSite=Lax), forwards to the API with a Bearer header, refreshes on 401 `TOKEN_EXPIRED` or `TOKEN_STALE`, and rewrites cookies. Mutating BFF requests must carry an `Origin` header matching the app's origin.
- **Guard order on every route**: `JwtAuthGuard` → `ModuleEnabledGuard` → `PermissionGuard`. A route is public only when decorated `@Public()`; a test enumerates all routes and fails if a non-public route lacks `@RequirePermission`.

#### Permission Catalogue

Permissions are `resource:action`. This table is the complete list and lives in `packages/types/src/permissions.ts`.

| Resource | Actions |
|---|---|
| `workspace` | `view`, `configure` |
| `user` | `view`, `create`, `edit`, `deactivate` |
| `role` | `view`, `configure` |
| `audit` | `view`, `export` |
| `field` | `view`, `configure` |
| `workflow` | `view`, `configure` |
| `product` | `view`, `create`, `edit`, `archive`, `export`, `view_cost` |
| `inventory` | `view`, `adjust`, `transfer`, `count`, `approve`, `export` |
| `supplier` | `view`, `create`, `edit`, `archive` |
| `purchase` | `view`, `create`, `edit`, `receive`, `approve`, `return` |
| `customer` | `view`, `create`, `edit`, `archive`, `merge`, `export`, `anonymize` |
| `lead` | `view`, `view_all`, `create`, `edit`, `archive`, `assign`, `export` |
| `task` | `view`, `view_all`, `create`, `edit` |
| `conversation` | `view`, `view_all`, `reply`, `assign` |
| `template` | `view`, `configure` |
| `quotation` | `view`, `create`, `edit`, `archive`, `approve`, `send` |
| `order` | `view`, `view_all`, `create`, `edit`, `cancel`, `approve`, `export`, `price_override`, `discount_override`, `deposit_override`, `complete_with_balance` |
| `production` | `view`, `view_all`, `edit`, `assign` |
| `pos` | `sell`, `open_session`, `close_session`, `cash_movement`, `reprint`, `refund`, `view_all_sessions` |
| `payment` | `view`, `create`, `confirm`, `void`, `refund` |
| `expense` | `view`, `create`, `void` |
| `account` | `view`, `configure` |
| `commission` | `view`, `view_all`, `approve`, `pay`, `configure` |
| `report` | `view`, `financial`, `view_all_staff`, `export`, `build` |
| `automation` | `view`, `configure` |
| `ai` | `use`, `control`, `view_logs` |
| `integration` | `view`, `manage` |
| `import` | `run` |
| `platform` | `admin` (never grantable inside a workspace) |

Mapping to the eleven actions of Requirement 2.4: `view`, `create`, `edit` map directly; `delete/archive` → `archive`, `deactivate`, `cancel`, `void`; `approve` → `*:approve`; `export` → `*:export`; `refund` → `payment:refund`, `pos:refund`; `financial_access` → `payment:*`, `expense:*`, `account:*`, `report:financial`, `product:view_cost`; `configuration` → `*:configure`; `integration_access` → `integration:*`; `ai_control_access` → `ai:control`.

`view` without `view_all` on `lead`, `task`, `conversation`, `order`, `production` and `commission` means "only records assigned to me".

#### Default Roles

| Role | Permissions |
|---|---|
| Owner | every permission except `platform:admin`; cannot be edited |
| Manager | everything except `workspace:configure`, `role:configure`, `field:configure`, `workflow:configure`, `integration:manage`, `account:configure` |
| Salesperson | `customer:view/create/edit`, `lead:view/create/edit`, `task:view/create/edit`, `conversation:view/reply`, `quotation:view/create/edit/send`, `order:view/create/edit`, `product:view`, `inventory:view`, `pos:sell`, `payment:view/create`, `commission:view`, `ai:use`, `report:view` |
| Cashier | `pos:sell/open_session/close_session/cash_movement/reprint`, `customer:view/create`, `product:view`, `inventory:view`, `payment:view/create` |
| Inventory Staff | `product:view/create/edit`, `inventory:view/adjust/transfer/count`, `supplier:view/create/edit`, `purchase:view/create/edit/receive` |
| Account Staff | `payment:*`, `expense:*`, `account:view`, `report:view/financial/export`, `order:view/view_all`, `customer:view`, `supplier:view`, `purchase:view`, `commission:view/view_all/pay`, `product:view/view_cost` |
| Production Staff | `production:view/edit` |
| AI/Automation Operator | `automation:view/configure`, `ai:use/control/view_logs`, `template:view/configure`, `conversation:view/view_all/reply/assign` |
| Viewer | `*:view` on modules chosen when assigned; no `financial`, no `view_cost` |

Each Role also has `maxDiscountPercent` (Owner 100, Manager 20, Salesperson 5, Cashier 0 by default).

### 3. Configuration Engine

Three parts, all data.

**(a) Workspace settings** — `Workspace.config` JSONB, validated by `WorkspaceConfigSchema` (Zod, in `packages/validators`), read through `SettingsService.get(path)` which caches per request:

```typescript
interface WorkspaceConfig {
  business:   { legalName: string; phone?: string; email?: string; address?: string; taxNumber?: string };
  branding:   { logoFileId?: string; primaryColor?: string };
  locale:     { currency: string; currencyDecimals: number; timezone: string; language: string; dateFormat: string };
  modules:    { pos: boolean; purchasing: boolean; commissions: boolean; messaging: boolean; ai: boolean;
                automation: boolean; production: boolean; priceLists: boolean; multiLocation: boolean };
  tax:        { enabled: boolean; pricesIncludeTax: boolean; defaultTaxClassId?: string };
  numbering:  Record<DocumentType, { prefix: string; includeYear: boolean; padding: number }>;
  documents:  { receiptPaper: '58mm' | '80mm' | 'A4'; receiptFooter?: string; quotationTerms?: string;
                invoiceTerms?: string; showBankDetails: boolean; quotationValidityDays: number;
                autoInvoiceOnSystemRole?: 'DELIVERED' | 'COMPLETED' | null };
  sales:      { requiredDepositPercent: number; discountOverLimit: 'REJECT' | 'APPROVAL';
                cashRoundingIncrement: number | null; leadDedupWindowHours: number };
  inventory:  { allowNegativeStock: boolean; valuationMethod: 'WEIGHTED_AVERAGE';
                adjustmentApprovalThreshold: number | null; defaultLocationId?: string };
  commission: { triggerSystemRole: 'COMPLETED' | 'DELIVERED' | 'CONFIRMED' };
  pos:        { requireSessionFloat: boolean; allowMultipleOpenSessionsPerCashier: false };
  messaging:  { automationEnabled: boolean; businessHours?: WeeklyHours; optOutKeywords: string[] };
  ai:         { mode: 'OFF' | 'ASSIST' | 'AUTO_REPLY'; provider?: string; model?: string; tone: 'FORMAL' | 'FRIENDLY';
                replyLanguage: 'MATCH_CUSTOMER' | string; maxReplyChars: number; confidenceThreshold: number;
                escalationKeywords: string[]; contextMessageCount: number; visionEnabled: boolean;
                dailyRequestLimit: number; monthlyTokenBudget: number; autoReplyCategories: string[] };
  retention:  { messagesMonths: number | null; aiLogsMonths: number | null };
  terminology: Record<TermKey, { singular: string; plural: string }>;
  duplicates: { matchOn: Array<'PHONE' | 'EMAIL' | 'NAME_SIMILAR'> };
}
```

Every write validates the whole object, bumps `Workspace.configVersion`, writes an Audit_Event with the changed paths, and takes effect on the next request.

**(b) Field_Definitions** — see data model. The shared package `packages/calc/src/fields.ts` exports `validateCustomFields(definitions, values, context)` and `isVisible(definition, context)`, used unchanged by the API and the web app. A visibility condition is:

```typescript
type Condition = { all?: Condition[]; any?: Condition[] } |
  { source: 'field' | 'productType' | 'categoryId' | 'status'; key?: string;
    op: 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'exists'; value?: unknown };
```

Stored value shapes by type: `text` string; `number` decimal string; `date` ISO date; `boolean` boolean; `dropdown` option key; `multi-select` option key array; `measurement` `{ value: string, unit: string }`; `currency` decimal string; `image` file id; `reference` `{ entityType, id }`.

**(c) Workflows** — see data model and Requirement 27. `WorkflowService.transition(entityType, entityId, toKey, { note, actor })`:

1. Load the record and its workflow; find the transition from the current state to `toKey`; if none, throw 422 `TRANSITION_NOT_ALLOWED` with the allowed keys.
2. Check the transition's `requiredPermission` and `requiredFields`.
3. If `requiresApproval` and the actor lacks the matching `approve` permission, create an `ApprovalRequest` and return `{ pendingApproval: true }`.
4. Run pre-conditions registered for the target `systemRole` (for example deposit rule before `IN_PRODUCTION`, zero balance before `COMPLETED`).
5. In one transaction: update the record's state, write status history, run registered side effects for the target `systemRole`, write the Audit_Event.
6. After commit, publish `<entity>.status_changed`.

Side effects are registered in code against `(entityType, systemRole)`:

| Entity | System_Role | Pre-conditions | Side effects |
|---|---|---|---|
| Order | `CONFIRMED` | has at least one line; customer set | reserve stock for stock-tracked lines |
| Order | `IN_PRODUCTION` | deposit rule (39.5) | create Production_Jobs for custom lines (R3; in R1 none) |
| Order | `READY` | all Production_Jobs done (R3) | none |
| Order | `DELIVERED` | none | convert reservations to `SALE` movements; set delivered date; auto-invoice if configured |
| Order | `COMPLETED` | balance due is zero, or `order:complete_with_balance` | set `closedAt`; trigger commission calculation if this is the configured trigger |
| Order | `CANCELLED` | refund-or-credit decision if confirmed payments exist | release reservations; reverse commissions |
| Order | `ON_HOLD` | none | none (reservations kept) |
| Lead | `WON` | none | set `closedAt` |
| Lead | `LOST` | lost reason supplied | set `closedAt`, store reason |

**Industry Profiles** are rows in `IndustryProfile` whose `definition` JSON contains: `terminology`, `modules`, `fieldDefinitions[]`, `workflows[]`, `units[]`, `categories[]`, `questionFlow[]`, `dashboardKpis[]`, `lostReasons[]`, `expenseCategories[]`. `IndustryProfileService.apply(workspaceId, profileKey)` upserts these into the workspace by key and never deletes what the business has added. The furniture profile is defined in `prisma/seed/profiles/furniture.json`.

Furniture profile Field_Definitions (entity `ORDER_ITEM`, also offered on `QUOTATION_ITEM` and `LEAD`): `size_type` (dropdown: standard, custom), `length`, `width`, `height` (measurement, length; visible when `size_type = custom`), `area` (measurement, area), `material` (dropdown), `fabric` (text), `wood_type` (dropdown), `color` (text), `design` (text), `reference_image` (image), `customization_notes` (text), `estimated_production_days` (number).

### 4. Audit

`AuditService.record(tx, { action, entityType, entityId, before, after, metadata })` takes the transaction client, reads actor, role names and IP from the request context, and inserts into `audit_events`. Rules:

- Called by services for every create, update, archive, status change, approval, payment, void, refund, permission change, settings change, export, and login event.
- `before` and `after` contain only the changed fields, with secrets and password hashes removed by a redactor.
- Events with no surrounding transaction (failed login, webhook signature failure, adapter error) go through `AuditService.recordAsync`, which retries three times and then logs at error level with an alert tag.
- Migration `audit_append_only` creates a trigger `BEFORE UPDATE OR DELETE ON audit_events` that raises an exception.
- Read access: `GET /audit/events`, permission `audit:view`, filters by entity, actor, action and date.

### 5. Domain Events

`DomainEventBus.publish(name, payload)` is called after commit. Payloads always include `workspaceId`, `actorUserId`, `occurredAt` and entity ids only (listeners load what they need).

| Event | Published by | Listeners |
|---|---|---|
| `lead.created`, `lead.assigned`, `lead.status_changed` | crm | timeline, notifications, automation |
| `customer.created`, `customer.merged` | crm | timeline, search |
| `conversation.message_received`, `conversation.message_sent`, `conversation.message_status` | channels | timeline, notifications, ai, automation |
| `quotation.sent`, `quotation.accepted`, `quotation.expired` | orders | timeline, automation |
| `order.created`, `order.status_changed` | orders | timeline, notifications, commissions, automation, documents |
| `payment.confirmed`, `payment.voided`, `payment.refunded` | payments | timeline, orders (balance already updated in transaction), commissions, automation |
| `stock.low`, `stock.movement_posted` | inventory | notifications, automation |
| `purchase.received` | purchasing | timeline |
| `task.due` | tasks | notifications |
| `approval.requested`, `approval.decided` | workflows | notifications |
| `integration.failed` | integrations | notifications |
| `ai.escalated`, `ai.suggestion_created` | ai | notifications |
| `import.finished` | imports | notifications |

The **timeline** listener writes `TimelineEntry` rows; services do not write timeline entries themselves, except Notes and Tasks which create theirs directly.

### 6. Idempotency and Concurrency

- `@Idempotent()` on a POST handler requires an `Idempotency-Key` header. `IdempotencyInterceptor` stores `(workspaceId, key, route, requestHash, responseBody, status)` in `IdempotencyKey`; a repeat returns the stored response; the same key with a different request hash returns 409 `IDEMPOTENCY_KEY_REUSED`. Applied to: `POST /pos/checkout`, `/payments`, `/payments/:id/refund`, `/orders`, `/inventory/movements`, `/inventory/opening-stock`, `/purchases/:id/receive`, `/returns`.
- Optimistic concurrency: `Order`, `Quotation`, `Product`, `Customer`, `Lead` have `version Int`. PATCH bodies carry `version`; the update uses `where: { id, version }` and increments; zero rows updated returns 409 `STALE_VERSION`.
- Stock: every change to a `StockLevel` row is preceded, in the same transaction, by `SELECT ... FOR UPDATE` on that row, in ascending `(variantId, locationId)` order to avoid deadlocks.
- Document numbers: `DocumentSequence` row locked `FOR UPDATE`, incremented, used, all inside the document's transaction.

### 7. Files

`StorageAdapter { put(key, body, mime): Promise<void>; getSignedUrl(key, ttlSeconds): Promise<string>; delete(key): Promise<void>; head(key) }` with drivers `LocalDiskStorage` (development) and `S3Storage`. Upload flow: `POST /files` (multipart) → size check → content sniff with `file-type` against the allow-list → key `ws/<workspaceId>/<yyyy>/<mm>/<cuid>.<ext>` → `put` → thumbnail for images → `FileAsset` row → returns `{ id, name, mime, size }`. Entities reference files by `FileAsset.id`. `GET /files/:id/url` checks tenant and the permission of the linked entity, then returns a signed URL valid for 5 minutes.

---

## Module Designs

Each module lives in `apps/api/src/modules/<name>/` and exposes a service that other modules call. No module queries another module's tables.

### Catalog (`catalog`)

- Entities: `Category` (tree), `Brand`, `Product`, `ProductVariant`, `ProductImage`, `BundleComponent`, `PriceList`, `PriceListItem`.
- Every Product has at least one Variant. Creating a Product with no variants creates a default Variant with SKU from the pattern `{productCode}` (or a generated code `P-000123` when none is given).
- `generateVariants(productId, axes)` builds the Cartesian product of the option values of the given variant-axis Field_Definitions and creates one Variant per combination, SKU = `{productCode}-{optionKey1}-{optionKey2}`; existing combinations are skipped.
- SKU and barcode are unique per workspace (database constraints). `GET /catalog/variants/lookup?code=` matches barcode first, then SKU.
- Archiving sets `status = ARCHIVED`; archived Products and Variants are excluded from pickers and rejected on new Quotation, Order and POS lines with 422 `PRODUCT_ARCHIVED`; existing documents are unaffected.
- `product:view_cost` gates `costPrice` and average cost in every response (fields are omitted, not zeroed).
- Bundles (R3): a `BUNDLE` Product has its own price; selling one unit deducts each component's quantity from stock; a bundle has no stock of its own.

### Pricing, Discount and Tax (`packages/calc`)

One pure module, `packages/calc/src/pricing.ts`, used by quotations, orders, POS and invoices, and by the web app for live totals.

```typescript
calculateDocument(input: {
  lines: Array<{ quantity: Decimal; unitPrice: Decimal; discount?: { type: 'AMOUNT' | 'PERCENT'; value: Decimal };
                 taxRate: Decimal }>;
  orderDiscount?: { type: 'AMOUNT' | 'PERCENT'; value: Decimal };
  pricesIncludeTax: boolean; currencyDecimals: number; cashRoundingIncrement?: Decimal | null;
}): { lines: Array<{ gross; discountAmount; net; taxAmount; lineTotal }>;
      subtotal; discountAmount; taxAmount; roundingAmount; total }
```

Rules, in order:

1. `gross = quantity × unitPrice`.
2. Line discount: `PERCENT` → `gross × value / 100`; `AMOUNT` → `value`; capped at `gross`.
3. Order discount is allocated across lines in proportion to each line's net after line discount; the last line takes the remainder so the allocation sums exactly.
4. Tax-exclusive: `taxAmount = net × taxRate`; `lineTotal = net + taxAmount`. Tax-inclusive: `taxAmount = net − net / (1 + taxRate)`; `lineTotal = net`.
5. Each of `discountAmount`, `taxAmount`, `lineTotal` is rounded half-up to `currencyDecimals`.
6. `total = Σ lineTotal`; if `cashRoundingIncrement` is set and the payment is cash, `roundingAmount = round(total, increment) − total`.

Price resolution (`PricingService.resolveUnitPrice(variantId, customerId)`): customer's Price_List item → default active Price_List item → `variant.priceOverride` → `product.basePrice`. In R1 only the last two exist.

Discount limit: the effective percentage of line plus allocated order discount is compared with the highest `maxDiscountPercent` among the user's Roles. Over the limit: 422 `DISCOUNT_OVER_LIMIT` when `sales.discountOverLimit = 'REJECT'` (R1), or an `ApprovalRequest` (R3).

### Inventory (`inventory`)

- `StockMovement` is the immutable ledger of physical quantity changes. Movement types and sign: `OPENING_STOCK +`, `PURCHASE_RECEIPT +`, `ADJUSTMENT_IN +`, `TRANSFER_IN +`, `RETURN_IN +`, `SALE −`, `ADJUSTMENT_OUT −`, `TRANSFER_OUT −`, `RETURN_TO_SUPPLIER −`.
- `StockLevel(variantId, locationId)` holds `onHand`, `reserved`, `avgCost`. `available = onHand − reserved`.
- `InventoryService.post(tx, movements[])` is the only writer of the ledger: locks the affected `StockLevel` rows, checks negative-stock rule on `available`, inserts movements, updates `onHand`, and for inbound movements with a unit cost updates `avgCost = (onHand × avgCost + qty × unitCost) / (onHand + qty)` (when `onHand ≤ 0` before the receipt, `avgCost = unitCost`). After commit publishes `stock.movement_posted` and, when `available < minStockLevel` and it was not below before, `stock.low`.
- `reserve(tx, orderId, lines[])` locks rows, checks `available`, inserts `StockReservation` rows (`ACTIVE`), increases `reserved`. `release(tx, orderId)` marks them `RELEASED` and decreases `reserved`. `fulfil(tx, orderId)` marks them `FULFILLED`, decreases `reserved` and posts `SALE` movements.
- A line is stock-tracked only when its Variant's Product type is `STOCKABLE` and the line is not a custom line. `OrderItem.stockTracked` stores the decision at creation.
- Opening stock and adjustments are movements with `reasonId` (adjustments) and `note`. Adjustment approval (R3): when `|qty × avgCost| > inventory.adjustmentApprovalThreshold`, an `ApprovalRequest` is created and the movement is posted on approval.
- Transfers (R3): one transaction, `TRANSFER_OUT` at source and `TRANSFER_IN` at destination sharing a `referenceId`, carrying the source average cost.
- Stock counts (R3): `StockCount` with lines `(variantId, expectedQty, countedQty)`; posting creates `ADJUSTMENT_IN/OUT` movements for the differences with reason "correction".
- Batch, expiry and serial (R3): `StockMovement.batchNumber`, `expiryDate`, `serialNumber` are filled when the Product has `tracking ≠ NONE`; serial-tracked items move in quantity 1.
- Unit conversion: quantities arrive in a unit; `InventoryService` multiplies by the product's conversion factor to the base unit before posting.

### Purchasing (`purchasing`)

- `Supplier`, `PurchaseOrder` with items, `GoodsReceipt` with lines, `SupplierPayment`, `SupplierReturn`.
- Purchase_Order workflow default: Draft → Sent → Partially received → Received; Cancelled. `PARTIALLY_RECEIVED` and `RECEIVED` are set only by goods receipt.
- `receive(purchaseOrderId, lines[{ itemId, quantity, unitCost? }])`: creates a `GoodsReceipt`, posts `PURCHASE_RECEIPT` movements with unit cost (default the item's `unitCost`), increases `receivedQty`, sets the workflow state by comparing received with ordered. Receiving more than ordered is rejected with 422 unless `purchase:approve`.
- R1 offers a "quick purchase" screen: supplier, lines, cost, receive-all in one step; it creates the Purchase_Order and a full GoodsReceipt in one transaction.
- Payables: `payable = Σ received value − Σ supplier payments − Σ supplier returns` per supplier (R3 for payments and returns).

### CRM (`crm`)

- Phone numbers are normalized to E.164 using the workspace's default country; the normalized values are stored in `Customer.phonesNormalized` and `Lead.phoneNormalized` and indexed.
- Duplicate check on create and update returns `{ hasDuplicates, candidates[] }` with HTTP 409 `POSSIBLE_DUPLICATE` unless the request carries `confirmDuplicate: true`.
- One system Customer per workspace has `isWalkIn = true`; it is hidden from lists, cannot be edited or merged, and is used for anonymous POS sales.
- Merge (API in R3): one transaction moving Leads, Conversations, Quotations, Orders, Payments, Tasks, Notes, TimelineEntries, Files and credit to the survivor; unions phones, tags; archives the duplicate with `mergedIntoId`; audits.
- Computed customer figures (`lifetimeValue`, `totalPaid`, `outstandingBalance`, `creditBalance`) are queried, not stored, through `CustomerFinanceService`.
- Lead creation applies the dedup window: an open Lead with the same normalized phone or email created within `sales.leadDedupWindowHours` is returned instead of creating a new one (HTTP 200 with `existing: true`).
- `convertLead(leadId, target)`: `CUSTOMER` creates or links the Customer; `QUOTATION` and `ORDER` additionally create the document pre-filled with the Lead's product interest, quantity and custom fields, copy attachments, and copy `source`, `channel`, `campaign`. The Lead stays linked (`Quotation.leadId`, `Order.leadId`). When the linked Order reaches `CONFIRMED`, the Lead moves to the `WON` state automatically.
- Timeline: `GET /customers/:id/timeline` and `GET /leads/:id/timeline` read `TimelineEntry` ordered by `occurredAt` descending, cursor-paginated.

### Tasks and Notes (`tasks`)

- `Task` and `Note` are generic and link to one entity through `(entityType, entityId)`.
- A scheduler runs every 5 minutes: Tasks with `dueAt ≤ now`, `status = OPEN` and `dueNotifiedAt = null` publish `task.due` and set `dueNotifiedAt`.
- Setting `Lead.nextAction` and `Lead.nextActionDate` upserts the Lead's single open `FOLLOW_UP` Task.

### Search (`search`)

`GET /search?q=` runs one query per permitted entity type using `pg_trgm` GIN indexes on the searched columns, `ILIKE '%q%'` for text and normalized-digit matching for phones, limited to 5 each, in parallel. Raw SQL with bound `workspaceId`.

### Quotations and Orders (`orders`)

- Line model is shared: `kind` `CATALOG` (variant) or `CUSTOM` (made-to-order product or free text), quantity, unit, unit price, discount, tax, `customFields`, `fieldSnapshot`.
- Totals are computed by `packages/calc` on every create and update and stored.
- Quotation statuses are fixed: `DRAFT`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `CONVERTED`. Editing a `SENT` quotation creates a new version (R3: `rootId`, `versionNumber`, previous version becomes read-only); in R1 a sent quotation is edited in place and audited.
- `send` marks `SENT`, records `sentAt`, `sentVia` (`MANUAL`, `CONVERSATION`), and when sent through a Conversation attaches the PDF. View tracking (R2) uses a signed public link `GET /public/quotations/:token`.
- `accept` records the approval details of Requirement 39.4. `convert` creates the Order in one transaction, copying lines, prices, custom fields, attachments and attribution, and marks the quotation `CONVERTED`.
- A daily scheduler marks `SENT` quotations past `validUntil` as `EXPIRED`.
- Order status changes go only through `WorkflowService.transition`. Default Order workflow: Draft → Confirmed → Deposit paid → In production → Ready → Out for delivery → Delivered → Completed; On hold and Cancelled reachable from every non-terminal state. `Deposit paid` has no System_Role and is entered automatically when confirmed payments reach the required deposit while the Order is `Confirmed`.
- `Order.paymentStatus` is recalculated in every payment transaction, taking the first rule that matches, with `netPaid = paidAmount − refundedAmount`: `REFUNDED` when `refundedAmount > 0` and `netPaid = 0`; `UNPAID` when `netPaid = 0`; `OVERPAID` when `balanceDue < 0`; `PAID` when `balanceDue = 0`; `DEPOSIT_PAID` when `depositRequired > 0` and `netPaid ≥ depositRequired`; otherwise `PARTIALLY_PAID`.
- Orders with `source = POS` are created directly in the state holding System_Role `COMPLETED`, skipping reservation, with `SALE` movements posted in the checkout transaction.
- Salesperson attribution: `OrderSalesperson` rows; R1 writes one row at 100 percent from `Order.assignedToId`.

### Production and Fulfilment (`production`, R3)

`ProductionJob` per custom line, created by the `IN_PRODUCTION` side effect; its status follows the workspace's Production_Job workflow (Queued → In progress → Quality check → Done). `GET /production/jobs` returns only jobs assigned to the caller unless `production:view_all`; the response omits prices unless `report:financial`. When the last job of an Order reaches a `done` state, `order.production_done` is published and, when configured, the Order transitions to `READY`. Fulfilment fields live on `Order` and are edited through `PATCH /orders/:id/fulfilment`.

In R1 there is no Production_Job; the Order's own workflow states (In production, Ready) are moved by staff, and the fulfilment fields are editable on the order screen.

### Documents (`documents`)

- `DocumentRenderer.render(type, snapshot, options): Promise<Buffer>`; the only R1 implementation is `ReactPdfRenderer`.
- Snapshots: `Receipt.data`, `Invoice.data` and `Quotation.sentSnapshot` hold everything needed to render (business block, customer, lines with field snapshot, totals, payments, bank details, terminology used). PDFs are rendered from the snapshot on request and not stored.
- Layouts: A4 for all; receipts additionally 80mm (226pt wide) and 58mm (164pt wide) with page height computed from the line count.
- Numbering: `NumberingService.next(tx, docType)` → `prefix + (year-) + zero-padded counter`.
- Endpoints stream `application/pdf` with `Content-Disposition: inline`, so the browser opens its viewer and print dialog.

### POS (`pos`)

`PosService.checkout(dto, idempotencyKey)` runs one transaction:

1. Load the caller's open `PosSession` (R1: opened automatically for the cashier and location on first sale of the day; R3: must be opened explicitly with a float).
2. Resolve prices, validate discount limit, calculate totals with `packages/calc`.
3. Validate payments: R1 exactly one payment whose amount ≥ total for cash (change = tendered − total) or = total for other methods; R3 several payments whose sum ≥ total, with change given only against cash.
4. Create the `Order` (`source = POS`, `orderType = POS`, state `COMPLETED`), its lines with cost snapshot, and `OrderSalesperson`.
5. `InventoryService.post` `SALE` movements for stock-tracked lines.
6. Create `Payment` rows, `CONFIRMED`, linked to the session; set `paidAmount`, `balanceDue = 0`.
7. Allocate the receipt number and create `Receipt` with its full data snapshot.
8. Write Audit_Events. After commit publish `order.created`, `payment.confirmed`; commission is calculated by the listener.

Returns the order, receipt id and change due. Receipt PDF is fetched separately; a rendering failure never affects the sale.

Session closing (R3): `expected = openingFloat + Σ cash payments − Σ cash refunds + Σ cash in − Σ cash out`; the cashier enters the counted amount; `discrepancy = counted − expected` is stored; the session becomes `CLOSED` and immutable.

### Payments and Finance (`payments`)

- `PaymentsService.record(dto)`: staff-entered payments are created `CONFIRMED` when the user has `payment:confirm`, otherwise `PENDING_VERIFICATION`. Confirming, rejecting and voiding are separate endpoints.
- Every change that affects an Order runs `recalculateOrder(tx, orderId)`:

```
paidAmount     = Σ amount of CONFIRMED payments of type ORDER_PAYMENT, DEPOSIT, CREDIT_APPLIED
refundedAmount = Σ amount of CONFIRMED payments of type REFUND
netTotal       = totalAmount − returnedAmount
balanceDue     = netTotal − (paidAmount − refundedAmount)
```

- An `ADVANCE` (no order) adds to the customer's credit (`CustomerCredit` ledger). Applying credit to an Order writes a negative `CustomerCredit` row and a `CREDIT_APPLIED` payment. An overpayment is flagged on the Order (`paymentStatus = OVERPAID`) and can be moved to credit with one action.
- Expenses: `Expense` with category, account, method, attachment; voided with reason, never edited after posting.
- Receivables: per customer `Σ netTotal − Σ net paid` over non-cancelled Orders; ageing by order date. Account movements: per `FinancialAccount`, confirmed payments in, refunds, supplier payments and expenses out.

### Commissions (`commissions`)

`CommissionService.calculateForOrder(orderId)` runs when an Order enters the System_Role in `commission.triggerSystemRole` (POS sales: immediately), once per order (unique on `(orderId, salespersonId, orderItemId)`):

1. For each salesperson in `OrderSalesperson` and each order line, select the rule by the precedence of Requirement 41.4 among active rules.
2. Base per line: `NET_SALES` = line net after discounts, before tax; `GROSS_SALES` = quantity × unit price; `GROSS_PROFIT` = net − quantity × cost price (zero when cost unknown).
3. Amount: `PERCENTAGE` → base × rate / 100; `FIXED_PER_UNIT` → rate × quantity; `FIXED_PER_ORDER` → rate, once per order on the first line. Multiply by the salesperson's share percent. Round half-up to currency decimals.
4. Insert `Commission` rows with status `PENDING`. Lines with no matching rule create no row.

Status flow: `PENDING → APPROVED | REJECTED` (`commission:approve`), `APPROVED → PAID` (`commission:pay`, with date and method). Cancellation or full refund sets every non-reversed row to `REVERSED`. A partial return (R3) inserts a negative adjustment row linked by `reversalOfId`, proportional to returned value.

R1 exposes commission setup as one percentage per staff member on the staff profile screen, which creates or updates a salesperson-scoped `PERCENTAGE` rule on `NET_SALES` with scope `ALL`.

### Channels and Integrations (`channels`, `integrations`)

```typescript
// packages/types/src/channel.ts
export interface ChannelAdapter {
  readonly provider: ChannelProvider;                       // 'WHATSAPP' | 'FACEBOOK_LEADS' | 'INSTAGRAM'
  verifyChallenge(query: Record<string, string>, connection?: IntegrationSecrets): string | null;
  verifySignature(rawBody: Buffer, headers: Record<string, string>, appSecret: string): boolean;
  extractAccountIds(payload: unknown): string[];            // to resolve the workspace
  parseEvents(payload: unknown): NormalizedEvent[];         // messages, statuses, lead forms
  canSendFreeform(conversation: { lastInboundAt: Date | null }): boolean;
  sendMessage(conn: IntegrationSecrets, to: string, content: OutboundContent): Promise<SendResult>;
  downloadMedia(conn: IntegrationSecrets, mediaRef: string): Promise<{ body: Buffer; mime: string }>;
  listTemplates?(conn: IntegrationSecrets): Promise<ProviderTemplate[]>;
  testConnection(conn: IntegrationSecrets): Promise<HealthResult>;
}

type NormalizedEvent =
  | { kind: 'message'; dedupeKey: string; accountId: string; externalContactId: string; contactName?: string;
      contactPhone?: string; externalMessageId: string; type: MessageType; body?: string;
      media?: { ref: string; mime?: string; name?: string }[]; timestamp: Date }
  | { kind: 'status'; dedupeKey: string; accountId: string; externalMessageId: string;
      status: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'; reason?: string; timestamp: Date }
  | { kind: 'lead_form'; dedupeKey: string; accountId: string; formId: string; adId?: string;
      campaign?: string; fields: Record<string, string>; timestamp: Date };
```

Inbound pipeline:

1. `GET /webhooks/:provider` answers the provider's verification challenge.
2. `POST /webhooks/:provider` (public, raw body preserved): resolve candidate connections from `extractAccountIds`; verify the signature with the platform app secret; on failure 401 and audit. Insert one `WebhookEvent` per normalized event with its `dedupeKey` (unique per provider; a duplicate insert is ignored); enqueue `channel.inbound` jobs; then respond 200. Unknown account: store as `IGNORED`, respond 200.
3. `ChannelInboundProcessor` (sets workspace context from the connection), by event kind:
   - **message**: find or create the `Conversation` by `(connectionId, externalContactId)`; match identity by normalized phone to a Customer, else an open Lead, else create a Lead (`source = MESSAGING`, channel set); insert the `Message` (unique on `externalId`); download media to storage; update `lastInboundAt`, `lastMessageAt`, `unreadCount`; reopen if closed; apply opt-out keywords; publish `conversation.message_received`.
   - **status**: update the `Message` only if the new status ranks higher (`QUEUED 0 < SENT 1 < DELIVERED 2 < READ 3`; `FAILED` only from `QUEUED` or `SENT`). If the message is not yet known, the job retries with backoff (out-of-order delivery).
   - **lead_form**: create a Lead with attribution and mapped fields (Requirement 42.8).
4. Failures retry 3 times with exponential backoff (30s, 2m, 10m); then `WebhookEvent.status = FAILED`, audit, `integration.failed`.

Outbound: `ConversationService.send(conversationId, content, actor)` checks consent and `canSendFreeform` (otherwise only an approved template is accepted, 422 `FREEFORM_WINDOW_CLOSED`), inserts the `Message` as `QUEUED`, enqueues `channel.outbound`; the processor calls the adapter through a circuit breaker with a 10-second timeout, stores the provider message id and `SENT`, or `FAILED` with reason after retries. A message sent by a staff member sets `automationActive = false` on the Conversation (human takeover).

Templates: `MessageTemplate` covers quick replies, internal templates and provider templates (`providerName`, `language`, `providerStatus`). Variables `{{customer_name}}`, `{{order_number}}`, `{{order_total}}`, `{{balance_due}}`, `{{business_name}}`, `{{bank_details}}`, `{{follow_up_date}}` are resolved by `TemplateService.render(template, context)`; an unresolved variable blocks sending with 422.

Secrets: `IntegrationConnection.configEncrypted` is AES-256-GCM (`iv:ciphertext:tag`, key from `INTEGRATION_ENCRYPTION_KEY`). Reads return masked values (`••••1234`).

### AI (`ai`)

```typescript
// packages/types/src/ai.ts
export interface AIAdapter {
  readonly provider: string;
  generateStructured<T>(req: { system: string; messages: ChatMessage[]; schema: JsonSchema;
    maxTokens: number; timeoutMs: number }): Promise<{ data: T; usage: TokenUsage; model: string }>;
  generateText(req: { system: string; messages: ChatMessage[]; maxTokens: number; timeoutMs: number }):
    Promise<{ text: string; usage: TokenUsage; model: string }>;
}
```

`AIService` flow for every function:

```
1. Gate:   workspace ai.mode ≠ OFF, module enabled, conversation.aiEnabled, usage limits not reached
           → otherwise return { disabled: true, reason } and call nothing
2. Context pack (ContextBuilder):
           business profile, tone and language settings, industry profile name, question flow,
           required Field_Definitions for the matched category, active Knowledge_Items,
           candidate products (search of AI-visible products by terms in the conversation) each with
           current price and available quantity, customer-facing bank accounts (only for bank-details intent),
           last N messages of the conversation (text only unless visionEnabled)
3. Call:   adapter.generateStructured / generateText through timeout (30s) and circuit breaker
4. Validate (deterministic, no model):
           - schema validation of structured output
           - each extracted value: confidence = LOW unless the value (or its normalized form) occurs
             in the conversation text; product matches must be ids from the context pack
           - draft replies: every currency amount and every availability statement must equal a value
             in the context pack → otherwise flag UNVERIFIED_AMOUNT / UNVERIFIED_AVAILABILITY
           - forbidden intents in a draft (discount offer, payment confirmation, refund, delivery date
             not in data) → flag FINANCIAL_COMMITMENT
5. Persist: AISuggestion (status PENDING, payload, flags, confidence) and AIActionLog (provider, model,
            prompt hash, response hash, tokens, latency, outcome); increment AIUsage
6. Escalate: any flag, overall confidence < threshold, escalation keyword in the last inbound message,
            or adapter failure → conversation.needsHuman = true, publish ai.escalated
```

- Functions: `summarize`, `extractRequirements` (returns `fields`, `missingFields`, `productCandidates`), `classifyLead`, `draftReply`, `nextQuestion`, `suggestNextAction`, `generateNote`.
- Triggering in `ASSIST` mode: on `conversation.message_received`, a debounced job (20 seconds after the last inbound message) runs `extractRequirements` and `draftReply` and stores suggestions. Staff can also run any function on demand.
- Applying a suggestion: `POST /ai/suggestions/:id/apply` with the (possibly edited) payload writes to the Lead or Customer, marks the suggestion `APPROVED` or `EDITED`, records the approver, and audits with `source: 'AI'`. Nothing is written before this call.
- `AUTO_REPLY` (R2): after step 4, a draft with no flags, in an enabled category, for a conversation with `automationActive = true` and consent, is sent as `senderType = AI`; everything else waits for staff.
- Prompts live in `apps/api/src/modules/ai/prompts/*.ts`, versioned by a `promptVersion` string stored in `AIActionLog`.
- Data sent to the provider is exactly the context pack. `docs/ai-data-handling.md` lists every field and is the source for the summary shown in AI settings.

### Automation (`automation`, R2)

- `AutomationRule { trigger, conditions, action, actionParams, enabled, maxRetries }`.
- Triggers: every Domain_Event in the table above, plus scheduled triggers evaluated every 15 minutes: `lead.no_contact_days(n)`, `task.overdue`, `order.payment_due_in_days(n)`, `quotation.expiring_in_days(n)`.
- Conditions use the same `Condition` structure as field visibility, evaluated against the event's entity.
- Actions: `SEND_MESSAGE` (template, to the record's customer), `CREATE_LEAD`, `UPDATE_LEAD`, `CREATE_TASK`, `SEND_NOTIFICATION`, `UPDATE_ORDER_STATUS` (through `WorkflowService`, so all rules still apply).
- Safeguards: `SEND_MESSAGE` runs only when platform, workspace and conversation automation are on, within business hours when configured, with consent, and with a provider-approved template when outside the free-form window. Events caused by automation carry `causedBy: 'AUTOMATION'` and never trigger rules. A rule fires at most once per entity per trigger per 24 hours (`AutomationLog` dedupe key).
- Every evaluation that matches writes `AutomationLog` and an Audit_Event.

### Notifications (`notifications`)

`NotificationService` listens to the events listed in Requirement 33.2, resolves recipients (assignee, else members holding the mapped permission), applies `NotificationPreference`, inserts `Notification` rows and, when email is enabled for the user and type and an Email_Adapter is configured, enqueues an email. The web app polls `GET /notifications/unread-count` every 30 seconds. R1: in-app only, default preferences, no preference screen.

### Reporting (`reporting`)

- Each report is a `ReportDefinition` in code: `{ key, title, permission, financial, filters[], columns[], totals[], query(filters, ctx), drilldown(row) }`. One generic controller serves `GET /reports/:key` and `POST /reports/:key/export`; one generic web page renders any definition.
- Sales figures count Orders whose state category is not `cancelled` and not draft, dated by `orderDate` in the workspace timezone; returns are negative in the period of the return.
- `financial: true` reports require `report:financial`; non-financial reports strip money columns marked `financial` for users without it.
- Profit and loss: gross sales − discounts − returns = net sales; − cost of goods sold (Σ line quantity × cost snapshot) = gross profit; − expenses = net profit.
- Exports: CSV streamed; PDF through the document renderer; each export audited.
- Reports whose date range exceeds 92 days, and all exports over 5,000 rows, run as `report.generate` jobs with status polling.
- Custom report builder (R4): `SavedReport { dataset, dimensions[], measures[], filters[], sharedRoleIds[] }` compiled to a parameterized query from a fixed whitelist of columns per dataset.

### Imports (`imports`, R3) and Platform (`platform`, R4)

- Imports: `ImportJob` with file, mapping, mode (`ALL_OR_NOTHING`, `SKIP_INVALID`), duplicate mode (`SKIP`, `UPDATE`), counts and an errors file; processed by the `import.run` queue in batches of 500 inside transactions.
- Platform: `User.isPlatformAdmin`; `/platform/*` routes use `PlatformAdminGuard` and the unscoped client restricted to `Workspace` and membership counts. Support access is a `SupportAccessGrant` row created by an Owner with an expiry.

### Extension Points

A future module plugs in through: (1) Domain_Events it subscribes to or publishes; (2) Field_Definitions on its entities; (3) a Workflow for its entity type; (4) an adapter interface for any external service; (5) a navigation registry entry `{ area, label, route, permission, module }` in `apps/web/lib/navigation.ts`; (6) a `modules.<name>` toggle checked by `ModuleEnabledGuard`.

---

## Data Models

### Schema Rules

1. Every model below except those marked `// GLOBAL` is tenant-scoped: it has `workspaceId String` (required), a relation to `Workspace`, and an index starting with `workspaceId`. To keep this listing readable, the `workspace` relation line and the `@@index([workspaceId])` line are **not repeated** on each model; add both to every tenant-scoped model.
2. A field commented `// → Model` is a foreign key. Declare the Prisma relation and the back-relation on the other model. `// → User` fields reference `User.id`.
3. All ids are `String @id @default(cuid())`. All money and quantity fields are `Decimal @db.Decimal(18, 4)`; rates and percentages are `Decimal @db.Decimal(9, 4)`.
4. Uniqueness is always per workspace: `@@unique([workspaceId, ...])`.
5. Table and column names are mapped to snake_case with `@@map` / `@map`.
6. `customFields Json @default("{}")` columns hold values keyed by `FieldDefinition.key` and get a GIN index.
7. Status columns holding a workflow state key are `String`; fixed status sets are enums.
8. Migrations are created per phase (see `tasks.md`), each with a `rollback.sql`.
9. A foreign key to a model that a later task introduces is created as a plain nullable column first; its relation and constraint are added by the migration that introduces the target model.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
// The first migration runs: CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS citext;

// ═══ Platform and identity ═══════════════════════════════════════════════

model Workspace {                         // the tenant; not in TENANT_MODELS
  id              String   @id @default(cuid())
  name            String
  slug            String   @unique
  industryProfile String                  // IndustryProfile.key
  config          Json     @default("{}") // WorkspaceConfig
  configVersion   Int      @default(1)
  status          WorkspaceStatus @default(ACTIVE)
  isDemo          Boolean  @default(false)
  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
enum WorkspaceStatus { ACTIVE SUSPENDED DELETED }

model User {                              // GLOBAL
  id              String   @id @default(cuid())
  email           String   @unique @db.Citext
  passwordHash    String?
  firstName       String
  lastName        String
  status          UserStatus @default(PENDING)
  isPlatformAdmin Boolean  @default(false)
  lockedUntil     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
enum UserStatus { PENDING ACTIVE INACTIVE }

model UserSession {                       // GLOBAL
  id               String   @id @default(cuid())
  userId           String   // → User
  workspaceId      String?  // → Workspace (the workspace the session is for)
  familyId         String   // rotation family; reuse of a rotated token revokes the family
  refreshTokenHash String   @unique
  expiresAt        DateTime
  rotatedAt        DateTime?
  revokedAt        DateTime?
  ipAddress        String?
  userAgent        String?
  createdAt        DateTime @default(now())
  @@index([userId])
}

model PasswordResetToken {                // GLOBAL
  id        String   @id @default(cuid())
  userId    String   // → User
  tokenHash String   @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
}

model LoginAttempt {                      // GLOBAL
  id        String   @id @default(cuid())
  email     String   @db.Citext
  ipAddress String?
  success   Boolean
  createdAt DateTime @default(now())
  @@index([email, createdAt])
}

model IndustryProfile {                   // GLOBAL
  key        String  @id                  // 'furniture', 'restaurant', ...
  name       String
  definition Json                         // terminology, modules, fieldDefinitions, workflows, units, ...
  active     Boolean @default(true)
}

model PlatformSetting {                   // GLOBAL
  key   String @id                        // 'allowPublicSignup', 'automationEnabled'
  value Json
}

model UserWorkspace {                     // membership + staff profile
  id                String   @id @default(cuid())
  workspaceId       String
  userId            String   // → User
  status            UserStatus @default(ACTIVE)
  permVersion       Int      @default(1)
  phone             String?
  jobTitle          String?
  employeeCode      String?
  joinDate          DateTime?
  isSalesperson     Boolean  @default(false)
  defaultLocationId String?  // → InventoryLocation
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  roles             UserWorkspaceRole[]
  @@unique([workspaceId, userId])
}

model Role {
  id                 String   @id @default(cuid())
  workspaceId        String
  name               String
  isSystem           Boolean  @default(false)
  isOwner            Boolean  @default(false)
  permissions        String[]
  maxDiscountPercent Decimal  @default(0) @db.Decimal(9, 4)
  viewerModules      String[]
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
  @@unique([workspaceId, name])
}

model UserWorkspaceRole {
  workspaceId     String
  userWorkspaceId String   // → UserWorkspace
  roleId          String   // → Role
  @@id([userWorkspaceId, roleId])
}

model Invitation {
  id          String   @id @default(cuid())
  workspaceId String
  email       String   @db.Citext
  roleIds     String[]
  tokenHash   String   @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  invitedById String   // → User
  createdAt   DateTime @default(now())
}

model SupportAccessGrant {                // R4
  id          String   @id @default(cuid())
  workspaceId String
  grantedById String   // → User (Owner)
  expiresAt   DateTime
  revokedAt   DateTime?
  createdAt   DateTime @default(now())
}

// ═══ Cross-cutting ═══════════════════════════════════════════════════════

model AuditEvent {                        // append-only; trigger blocks UPDATE and DELETE
  id            String   @id @default(cuid())
  workspaceId   String
  actorUserId   String?
  actorType     String   @default("USER") // USER | SYSTEM | AUTOMATION | AI | WEBHOOK
  actorRole     String?
  action        String                    // 'order.create', 'payment.void', 'auth.login_failed'
  entityType    String
  entityId      String
  previousState Json?
  newState      Json?
  metadata      Json?
  ipAddress     String?
  userAgent     String?
  requestId     String?
  createdAt     DateTime @default(now())
  @@index([workspaceId, createdAt])
  @@index([workspaceId, entityType, entityId])
  @@index([workspaceId, actorUserId, createdAt])
}

model IdempotencyKey {
  id           String   @id @default(cuid())
  workspaceId  String
  key          String
  route        String
  requestHash  String
  responseBody Json?
  statusCode   Int?
  createdAt    DateTime @default(now())
  @@unique([workspaceId, key, route])
}

model DocumentSequence {
  id          String @id @default(cuid())
  workspaceId String
  docType     DocumentType
  year        Int    @default(0)          // 0 when numbering does not include the year
  nextValue   Int    @default(1)
  @@unique([workspaceId, docType, year])
}
enum DocumentType { QUOTATION ORDER INVOICE RECEIPT REFUND_RECEIPT PURCHASE_ORDER GOODS_RECEIPT RETURN PAYMENT }

model FileAsset {
  id           String   @id @default(cuid())
  workspaceId  String
  storageKey   String
  thumbnailKey String?
  originalName String
  mimeType     String
  sizeBytes    Int
  entityType   String?                    // PRODUCT | ORDER | ORDER_ITEM | QUOTATION | LEAD | CUSTOMER | EXPENSE | PAYMENT | MESSAGE | IMPORT
  entityId     String?
  purpose      String?                    // 'image' | 'reference' | 'proof' | 'attachment' | 'media'
  uploadedById String?  // → User
  createdAt    DateTime @default(now())
  @@index([workspaceId, entityType, entityId])
}

model FieldDefinition {
  id            String   @id @default(cuid())
  workspaceId   String
  entityType    FieldEntity
  key           String
  label         String
  type          FieldType
  unitDimension String?                   // for MEASUREMENT: length | area | weight | volume
  defaultUnit   String?
  options       Json     @default("[]")   // [{ key, label }]
  required      Boolean  @default(false)
  defaultValue  Json?
  categoryId    String?  // → Category (scope); null = all
  visibleWhen   Json?                     // Condition
  isVariantAxis Boolean  @default(false)
  sortOrder     Int      @default(0)
  active        Boolean  @default(true)
  isSystem      Boolean  @default(false)  // created by an industry profile
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([workspaceId, entityType, key])
}
enum FieldEntity { PRODUCT VARIANT ORDER_ITEM QUOTATION_ITEM CUSTOMER LEAD ORDER QUOTATION SUPPLIER PURCHASE_ORDER EXPENSE }
enum FieldType   { TEXT NUMBER DATE BOOLEAN DROPDOWN MULTI_SELECT MEASUREMENT CURRENCY IMAGE REFERENCE }

model Workflow {
  id          String   @id @default(cuid())
  workspaceId String
  entityType  WorkflowEntity
  name        String
  states      WorkflowState[]
  transitions WorkflowTransition[]
  @@unique([workspaceId, entityType])
}
enum WorkflowEntity { LEAD ORDER PURCHASE_ORDER PRODUCTION_JOB }

model WorkflowState {
  id          String  @id @default(cuid())
  workspaceId String
  workflowId  String  // → Workflow
  key         String                      // stored on records
  label       String
  color       String  @default("#64748b")
  category    StateCategory
  systemRole  String?                     // DRAFT | CONFIRMED | IN_PRODUCTION | READY | DELIVERED | COMPLETED | CANCELLED | ON_HOLD | NEW | WON | LOST | SENT | PARTIALLY_RECEIVED | RECEIVED | QUEUED | DONE
  isInitial   Boolean @default(false)
  sortOrder   Int     @default(0)
  active      Boolean @default(true)
  @@unique([workflowId, key])
}
enum StateCategory { OPEN IN_PROGRESS DONE CANCELLED }

model WorkflowTransition {
  id                 String   @id @default(cuid())
  workspaceId        String
  workflowId         String   // → Workflow
  fromStateId        String   // → WorkflowState
  toStateId          String   // → WorkflowState
  requiredPermission String?
  requiredFields     String[]
  requiresApproval   Boolean  @default(false)
  @@unique([workflowId, fromStateId, toStateId])
}

model StatusHistory {                     // replaces LeadStageHistory and OrderStatusHistory
  id          String   @id @default(cuid())
  workspaceId String
  entityType  String                      // LEAD | ORDER | PURCHASE_ORDER | PRODUCTION_JOB | QUOTATION
  entityId    String
  fromKey     String?
  toKey       String
  changedById String?  // → User
  actorType   String   @default("USER")
  note        String?
  createdAt   DateTime @default(now())
  @@index([workspaceId, entityType, entityId, createdAt])
}

model ApprovalRequest {
  id            String   @id @default(cuid())
  workspaceId   String
  type          String                    // WORKFLOW_TRANSITION | DISCOUNT | REFUND | STOCK_ADJUSTMENT
  entityType    String
  entityId      String
  payload       Json                      // what will be applied on approval
  status        ApprovalStatus @default(PENDING)
  requestedById String   // → User
  decidedById   String?  // → User
  decidedAt     DateTime?
  decisionNote  String?
  createdAt     DateTime @default(now())
}
enum ApprovalStatus { PENDING APPROVED REJECTED CANCELLED }

model Unit {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  symbol      String
  dimension   String                      // count | weight | length | area | volume | time
  toBase      Decimal @db.Decimal(18, 8)  // factor to the dimension's base unit
  @@unique([workspaceId, symbol])
}

model TaxClass {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  rate        Decimal @db.Decimal(9, 4)   // 0.1700 = 17%
  active      Boolean @default(true)
  @@unique([workspaceId, name])
}

model TimelineEntry {
  id          String   @id @default(cuid())
  workspaceId String
  customerId  String?  // → Customer
  leadId      String?  // → Lead
  orderId     String?  // → Order
  type        String                      // MESSAGE | NOTE | CALL | TASK | QUOTATION | ORDER | PAYMENT | STATUS | SYSTEM
  refType     String?
  refId       String?
  summary     String
  actorUserId String?
  occurredAt  DateTime @default(now())
  @@index([workspaceId, customerId, occurredAt])
  @@index([workspaceId, leadId, occurredAt])
  @@index([workspaceId, orderId, occurredAt])
}

model Task {
  id            String   @id @default(cuid())
  workspaceId   String
  type          TaskType
  title         String
  description   String?
  dueAt         DateTime?
  status        TaskStatus @default(OPEN)
  assignedToId  String?  // → User
  entityType    String?                   // CUSTOMER | LEAD | ORDER | QUOTATION | CONVERSATION
  entityId      String?
  createdById   String?  // → User
  completedById String?  // → User
  completedAt   DateTime?
  dueNotifiedAt DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([workspaceId, assignedToId, status, dueAt])
}
enum TaskType   { CALL FOLLOW_UP MEETING REMINDER TODO }
enum TaskStatus { OPEN DONE CANCELLED }

model Note {
  id            String   @id @default(cuid())
  workspaceId   String
  entityType    String                    // CUSTOMER | LEAD | ORDER
  entityId      String
  kind          String   @default("NOTE") // NOTE | CALL
  body          String
  callDirection String?                   // INBOUND | OUTBOUND
  callOutcome   String?
  createdById   String?  // → User
  createdAt     DateTime @default(now())
  @@index([workspaceId, entityType, entityId])
}

model Notification {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String   // → User
  type        String
  title       String
  body        String?
  entityType  String?
  entityId    String?
  readAt      DateTime?
  createdAt   DateTime @default(now())
  @@index([workspaceId, userId, readAt, createdAt])
}

model NotificationPreference {            // R2
  id          String  @id @default(cuid())
  workspaceId String
  userId      String  // → User
  type        String
  inApp       Boolean @default(true)
  email       Boolean @default(false)
  @@unique([workspaceId, userId, type])
}

model OutboxEvent {                       // R2
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  payload     Json
  status      String   @default("PENDING") // PENDING | DISPATCHED | FAILED
  attempts    Int      @default(0)
  createdAt   DateTime @default(now())
  @@index([status, createdAt])
}

// ═══ Catalog ═════════════════════════════════════════════════════════════

model Category {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  parentId    String? // → Category
  sortOrder   Int     @default(0)
  active      Boolean @default(true)
  @@unique([workspaceId, parentId, name])
}

model Brand {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  active      Boolean @default(true)
  @@unique([workspaceId, name])
}

model Product {
  id             String   @id @default(cuid())
  workspaceId    String
  code           String                   // internal code
  name           String
  description    String?
  categoryId     String?  // → Category
  brandId        String?  // → Brand
  type           ProductType   @default(STOCKABLE)
  status         ProductStatus @default(ACTIVE)
  madeToOrder    Boolean  @default(false)
  tracking       TrackingMode @default(NONE)
  baseUnitId     String?  // → Unit
  saleUnitId     String?  // → Unit
  purchaseUnitId String?  // → Unit
  saleUnitFactor     Decimal @default(1) @db.Decimal(18, 8)
  purchaseUnitFactor Decimal @default(1) @db.Decimal(18, 8)
  basePrice      Decimal  @db.Decimal(18, 4)
  costPrice      Decimal? @db.Decimal(18, 4)
  taxClassId     String?  // → TaxClass
  tags           String[]
  aliases        String[]
  visibleInPos   Boolean  @default(true)
  visibleToAi    Boolean  @default(true)
  customFields   Json     @default("{}")
  version        Int      @default(1)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  variants       ProductVariant[]
  @@unique([workspaceId, code])
  @@index([workspaceId, status, categoryId])
}
enum ProductType   { STOCKABLE NON_STOCKABLE SERVICE BUNDLE }
enum ProductStatus { ACTIVE INACTIVE ARCHIVED }
enum TrackingMode  { NONE BATCH SERIAL }

model ProductVariant {
  id            String   @id @default(cuid())
  workspaceId   String
  productId     String   // → Product
  sku           String
  barcode       String?
  name          String?
  isDefault     Boolean  @default(false)
  priceOverride Decimal? @db.Decimal(18, 4)
  costOverride  Decimal? @db.Decimal(18, 4)
  weight        Decimal? @db.Decimal(18, 4)
  minStockLevel Decimal? @db.Decimal(18, 4)
  maxStockLevel Decimal? @db.Decimal(18, 4)
  status        ProductStatus @default(ACTIVE)
  customFields  Json     @default("{}")   // includes variant-axis values
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@unique([workspaceId, sku])
  @@unique([workspaceId, barcode])
}

model ProductImage {
  id          String  @id @default(cuid())
  workspaceId String
  productId   String  // → Product
  variantId   String? // → ProductVariant
  fileId      String  // → FileAsset
  sortOrder   Int     @default(0)
  isPrimary   Boolean @default(false)
}

model BundleComponent {                   // R3
  id                 String  @id @default(cuid())
  workspaceId        String
  bundleProductId    String  // → Product
  componentVariantId String  // → ProductVariant
  quantity           Decimal @db.Decimal(18, 4)
  @@unique([bundleProductId, componentVariantId])
}

model PriceList {                         // R3
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  isDefault   Boolean  @default(false)
  validFrom   DateTime?
  validTo     DateTime?
  active      Boolean  @default(true)
  @@unique([workspaceId, name])
}

model PriceListItem {                     // R3
  id          String  @id @default(cuid())
  workspaceId String
  priceListId String  // → PriceList
  variantId   String  // → ProductVariant
  price       Decimal @db.Decimal(18, 4)
  @@unique([priceListId, variantId])
}

// ═══ Inventory and purchasing ════════════════════════════════════════════

model InventoryLocation {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  type        String  @default("STORE")   // STORE | WAREHOUSE | SHOWROOM | DAMAGED
  isDefault   Boolean @default(false)
  active      Boolean @default(true)
  @@unique([workspaceId, name])
}

model StockMovement {                     // immutable ledger; no UPDATE or DELETE in code
  id            String   @id @default(cuid())
  workspaceId   String
  variantId     String   // → ProductVariant
  locationId    String   // → InventoryLocation
  movementType  MovementType
  quantityDelta Decimal  @db.Decimal(18, 4)   // signed, in base unit
  unitCost      Decimal? @db.Decimal(18, 4)
  referenceType String?                   // ORDER | PURCHASE | ADJUSTMENT | TRANSFER | RETURN | SUPPLIER_RETURN | COUNT | OPENING
  referenceId   String?
  reasonId      String?  // → AdjustmentReason
  batchNumber   String?
  expiryDate    DateTime?
  serialNumber  String?
  note          String?
  performedById String?  // → User
  createdAt     DateTime @default(now())
  @@index([workspaceId, variantId, locationId, createdAt])
  @@index([workspaceId, referenceType, referenceId])
}
enum MovementType {
  OPENING_STOCK PURCHASE_RECEIPT ADJUSTMENT_IN TRANSFER_IN RETURN_IN
  SALE ADJUSTMENT_OUT TRANSFER_OUT RETURN_TO_SUPPLIER
}

model StockLevel {                        // projection; always equals the ledger and active reservations
  id          String   @id @default(cuid())
  workspaceId String
  variantId   String   // → ProductVariant
  locationId  String   // → InventoryLocation
  onHand      Decimal  @default(0) @db.Decimal(18, 4)
  reserved    Decimal  @default(0) @db.Decimal(18, 4)
  avgCost     Decimal  @default(0) @db.Decimal(18, 4)
  updatedAt   DateTime @updatedAt
  @@unique([workspaceId, variantId, locationId])
}

model StockReservation {
  id          String   @id @default(cuid())
  workspaceId String
  orderId     String   // → Order
  orderItemId String   // → OrderItem
  variantId   String   // → ProductVariant
  locationId  String   // → InventoryLocation
  quantity    Decimal  @db.Decimal(18, 4)
  status      ReservationStatus @default(ACTIVE)
  createdAt   DateTime @default(now())
  closedAt    DateTime?
  @@index([workspaceId, orderId])
  @@index([workspaceId, variantId, locationId, status])
}
enum ReservationStatus { ACTIVE RELEASED FULFILLED }

model AdjustmentReason {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  active      Boolean @default(true)
  @@unique([workspaceId, name])
}

model StockCount {                        // R3
  id          String   @id @default(cuid())
  workspaceId String
  locationId  String   // → InventoryLocation
  status      String   @default("OPEN")   // OPEN | POSTED | CANCELLED
  createdById String?  // → User
  postedAt    DateTime?
  createdAt   DateTime @default(now())
  lines       StockCountLine[]
}

model StockCountLine {                    // R3
  id           String   @id @default(cuid())
  workspaceId  String
  stockCountId String   // → StockCount
  variantId    String   // → ProductVariant
  expectedQty  Decimal  @db.Decimal(18, 4)
  countedQty   Decimal? @db.Decimal(18, 4)
  @@unique([stockCountId, variantId])
}

model Supplier {
  id           String   @id @default(cuid())
  workspaceId  String
  name         String
  contactName  String?
  phone        String?
  email        String?
  address      String?
  notes        String?
  status       String   @default("ACTIVE") // ACTIVE | ARCHIVED
  customFields Json     @default("{}")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model PurchaseOrder {
  id           String   @id @default(cuid())
  workspaceId  String
  orderNumber  String
  supplierId   String   // → Supplier
  locationId   String   // → InventoryLocation
  status       String   @default("draft") // Workflow state key (PURCHASE_ORDER)
  orderDate    DateTime @default(now())
  expectedDate DateTime?
  subtotal     Decimal  @db.Decimal(18, 4)
  taxAmount    Decimal  @default(0) @db.Decimal(18, 4)
  totalAmount  Decimal  @db.Decimal(18, 4)
  notes        String?
  customFields Json     @default("{}")
  createdById  String?  // → User
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  items        PurchaseOrderItem[]
  @@unique([workspaceId, orderNumber])
}

model PurchaseOrderItem {
  id              String  @id @default(cuid())
  workspaceId     String
  purchaseOrderId String  // → PurchaseOrder
  variantId       String  // → ProductVariant
  quantity        Decimal @db.Decimal(18, 4)   // in purchase unit
  unitCost        Decimal @db.Decimal(18, 4)
  receivedQty     Decimal @default(0) @db.Decimal(18, 4)
  returnedQty     Decimal @default(0) @db.Decimal(18, 4)
  lineTotal       Decimal @db.Decimal(18, 4)
}

model GoodsReceipt {
  id              String   @id @default(cuid())
  workspaceId     String
  receiptNumber   String
  purchaseOrderId String   // → PurchaseOrder
  receivedById    String?  // → User
  receivedAt      DateTime @default(now())
  note            String?
  lines           Json                    // [{ purchaseOrderItemId, variantId, quantity, unitCost }]
  @@unique([workspaceId, receiptNumber])
}

model SupplierPayment {                   // R3
  id              String   @id @default(cuid())
  workspaceId     String
  supplierId      String   // → Supplier
  purchaseOrderId String?  // → PurchaseOrder
  paymentMethodId String   // → PaymentMethod
  accountId       String   // → FinancialAccount
  amount          Decimal  @db.Decimal(18, 4)
  paidAt          DateTime
  referenceNumber String?
  status          PaymentStatus @default(CONFIRMED)
  voidReason      String?
  recordedById    String?  // → User
  createdAt       DateTime @default(now())
}

model SupplierReturn {                    // R3
  id              String   @id @default(cuid())
  workspaceId     String
  returnNumber    String
  purchaseOrderId String   // → PurchaseOrder
  supplierId      String   // → Supplier
  reason          String
  totalAmount     Decimal  @db.Decimal(18, 4)
  lines           Json                    // [{ purchaseOrderItemId, variantId, quantity, unitCost }]
  createdById     String?  // → User
  createdAt       DateTime @default(now())
  @@unique([workspaceId, returnNumber])
}

// ═══ CRM ═════════════════════════════════════════════════════════════════

model Customer {
  id               String   @id @default(cuid())
  workspaceId      String
  fullName         String
  phones           String[]
  phonesNormalized String[]               // E.164; GIN index
  email            String?  @db.Citext
  billingAddress   Json?
  shippingAddress  Json?
  preferredChannel String?
  notes            String?
  tags             String[]
  source           String?
  channel          String?
  campaign         String?
  assignedToId     String?  // → User
  priceListId      String?  // → PriceList
  status           String   @default("ACTIVE") // ACTIVE | ARCHIVED | ANONYMIZED
  isWalkIn         Boolean  @default(false)
  mergedIntoId     String?  // → Customer
  customFields     Json     @default("{}")
  version          Int      @default(1)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  @@index([workspaceId, status])
}

model ContactConsent {                    // R2
  id                String   @id @default(cuid())
  workspaceId       String
  channelType       String
  externalContactId String
  customerId        String?  // → Customer
  status            String   @default("UNKNOWN") // OPTED_IN | OPTED_OUT | UNKNOWN
  source            String?
  changedAt         DateTime @default(now())
  @@unique([workspaceId, channelType, externalContactId])
}

model Lead {
  id              String   @id @default(cuid())
  workspaceId     String
  customerId      String?  // → Customer
  fullName        String
  phone           String?
  phoneNormalized String?
  email           String?  @db.Citext
  source          String?                 // MESSAGING | SOCIAL | STORE | WEBSITE | MANUAL | IMPORT
  channel         String?                 // WHATSAPP | FACEBOOK | INSTAGRAM | ...
  campaign        String?
  adId            String?
  formId          String?
  interest        String?                 // free-text product interest
  productId       String?  // → Product
  requirements    String?
  quantity        Decimal? @db.Decimal(18, 4)
  estimatedValue  Decimal? @db.Decimal(18, 4)
  quotedAmount    Decimal? @db.Decimal(18, 4)
  priority        String   @default("MEDIUM") // LOW | MEDIUM | HIGH
  stage           String   @default("new")    // Workflow state key (LEAD)
  assignedToId    String?  // → User
  lostReasonId    String?  // → LostReason
  nextAction      String?
  nextActionDate  DateTime?
  customFields    Json     @default("{}")
  closedAt        DateTime?
  version         Int      @default(1)
  createdById     String?  // → User
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@index([workspaceId, stage])
  @@index([workspaceId, phoneNormalized])
  @@index([workspaceId, assignedToId])
}

model LostReason {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  active      Boolean @default(true)
  @@unique([workspaceId, name])
}

// ═══ Sales ═══════════════════════════════════════════════════════════════

model Quotation {
  id              String   @id @default(cuid())
  workspaceId     String
  quotationNumber String
  customerId      String?  // → Customer
  leadId          String?  // → Lead
  status          QuotationStatus @default(DRAFT)
  validUntil      DateTime?
  subtotal        Decimal  @db.Decimal(18, 4)
  discountType    String?                 // AMOUNT | PERCENT
  discountValue   Decimal  @default(0) @db.Decimal(18, 4)
  discountAmount  Decimal  @default(0) @db.Decimal(18, 4)
  taxAmount       Decimal  @default(0) @db.Decimal(18, 4)
  totalAmount     Decimal  @db.Decimal(18, 4)
  notes           String?
  terms           String?
  source          String?
  channel         String?
  campaign        String?
  assignedToId    String?  // → User
  sentAt          DateTime?
  sentVia         String?
  sentSnapshot    Json?
  viewedAt        DateTime?
  acceptedAt      DateTime?
  acceptedVia     String?                 // IN_PERSON | MESSAGE | PHONE
  acceptanceRecordedById String? // → User
  acceptanceFileId String? // → FileAsset
  rejectedReason  String?
  rootId          String?                 // first version's id (R3 versioning)
  versionNumber   Int      @default(1)
  isLatest        Boolean  @default(true)
  customFields    Json     @default("{}")
  version         Int      @default(1)
  createdById     String?  // → User
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  items           QuotationItem[]
  @@unique([workspaceId, quotationNumber, versionNumber])
}
enum QuotationStatus { DRAFT SENT ACCEPTED REJECTED EXPIRED CONVERTED }

model QuotationItem {
  id             String   @id @default(cuid())
  workspaceId    String
  quotationId    String   // → Quotation
  lineNo         Int
  kind           LineKind @default(CATALOG)
  productId      String?  // → Product
  variantId      String?  // → ProductVariant
  name           String
  sku            String?
  description    String?
  quantity       Decimal  @db.Decimal(18, 4)
  unitId         String?  // → Unit
  listPrice      Decimal  @db.Decimal(18, 4)   // resolved price before override
  unitPrice      Decimal  @db.Decimal(18, 4)
  discountType   String?
  discountValue  Decimal  @default(0) @db.Decimal(18, 4)
  discountAmount Decimal  @default(0) @db.Decimal(18, 4)   // line + allocated order discount
  taxClassId     String?  // → TaxClass
  taxRate        Decimal  @default(0) @db.Decimal(9, 4)
  taxAmount      Decimal  @default(0) @db.Decimal(18, 4)
  lineTotal      Decimal  @db.Decimal(18, 4)
  customFields   Json     @default("{}")
  fieldSnapshot  Json     @default("[]")  // [{ key, label, value, unit }]
}
enum LineKind { CATALOG CUSTOM }

model Order {
  id               String   @id @default(cuid())
  workspaceId      String
  orderNumber      String
  customerId       String   // → Customer
  leadId           String?  // → Lead
  quotationId      String?  // → Quotation
  orderType        String   @default("STANDARD") // STANDARD | CUSTOM | POS
  source           String   @default("MANUAL")   // POS | MESSAGING | SOCIAL | STORE | WEBSITE | MANUAL
  channel          String?
  campaign         String?
  locationId       String   // → InventoryLocation
  status           String   @default("draft")    // Workflow state key (ORDER)
  paymentStatus    OrderPaymentStatus @default(UNPAID)
  orderDate        DateTime @default(now())
  subtotal         Decimal  @db.Decimal(18, 4)
  discountType     String?
  discountValue    Decimal  @default(0) @db.Decimal(18, 4)
  discountAmount   Decimal  @default(0) @db.Decimal(18, 4)
  taxAmount        Decimal  @default(0) @db.Decimal(18, 4)
  roundingAmount   Decimal  @default(0) @db.Decimal(18, 4)
  totalAmount      Decimal  @db.Decimal(18, 4)
  depositRequired  Decimal  @default(0) @db.Decimal(18, 4)
  paidAmount       Decimal  @default(0) @db.Decimal(18, 4)
  refundedAmount   Decimal  @default(0) @db.Decimal(18, 4)
  returnedAmount   Decimal  @default(0) @db.Decimal(18, 4)
  balanceDue       Decimal  @db.Decimal(18, 4)
  fulfilmentMethod String?                 // PICKUP | DELIVERY
  deliveryAddress  Json?
  scheduledAt      DateTime?
  deliveredAt      DateTime?
  deliveredById    String?  // → User
  receiverName     String?
  proofFileId      String?  // → FileAsset
  notes            String?
  internalNotes    String?
  assignedToId     String?  // → User (primary salesperson)
  posSessionId     String?  // → PosSession
  customFields     Json     @default("{}")
  cancelledAt      DateTime?
  cancelReason     String?
  closedAt         DateTime?
  version          Int      @default(1)
  createdById      String?  // → User
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
  items            OrderItem[]
  @@unique([workspaceId, orderNumber])
  @@index([workspaceId, status, orderDate])
  @@index([workspaceId, customerId])
  @@index([workspaceId, assignedToId])
}
enum OrderPaymentStatus { UNPAID DEPOSIT_PAID PARTIALLY_PAID PAID OVERPAID REFUNDED }

model OrderItem {
  id             String   @id @default(cuid())
  workspaceId    String
  orderId        String   // → Order
  lineNo         Int
  kind           LineKind @default(CATALOG)
  productId      String?  // → Product
  variantId      String?  // → ProductVariant
  name           String
  sku            String?
  description    String?
  quantity       Decimal  @db.Decimal(18, 4)
  returnedQty    Decimal  @default(0) @db.Decimal(18, 4)
  unitId         String?  // → Unit
  listPrice      Decimal  @db.Decimal(18, 4)
  unitPrice      Decimal  @db.Decimal(18, 4)
  costPrice      Decimal? @db.Decimal(18, 4)   // average cost snapshot at sale
  discountType   String?
  discountValue  Decimal  @default(0) @db.Decimal(18, 4)
  discountAmount Decimal  @default(0) @db.Decimal(18, 4)
  taxClassId     String?  // → TaxClass
  taxRate        Decimal  @default(0) @db.Decimal(9, 4)
  taxAmount      Decimal  @default(0) @db.Decimal(18, 4)
  lineTotal      Decimal  @db.Decimal(18, 4)
  stockTracked   Boolean  @default(false)
  notes          String?
  customFields   Json     @default("{}")
  fieldSnapshot  Json     @default("[]")
}

model OrderSalesperson {
  id           String  @id @default(cuid())
  workspaceId  String
  orderId      String  // → Order
  userId       String  // → User
  sharePercent Decimal @default(100) @db.Decimal(9, 4)
  @@unique([orderId, userId])
}

model ProductionJob {                     // R3
  id           String   @id @default(cuid())
  workspaceId  String
  orderId      String   // → Order
  orderItemId  String   // → OrderItem
  status       String   @default("queued") // Workflow state key (PRODUCTION_JOB)
  assignedToId String?  // → User
  dueDate      DateTime?
  notes        String?
  startedAt    DateTime?
  completedAt  DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@unique([orderItemId])
}

model Invoice {
  id            String   @id @default(cuid())
  workspaceId   String
  invoiceNumber String
  orderId       String   // → Order
  customerId    String   // → Customer
  issuedAt      DateTime @default(now())
  totalAmount   Decimal  @db.Decimal(18, 4)
  data          Json                      // immutable snapshot
  issuedById    String?  // → User
  @@unique([workspaceId, invoiceNumber])
}

model Return {                            // R3 (customer return)
  id              String   @id @default(cuid())
  workspaceId     String
  returnNumber    String
  orderId         String   // → Order
  customerId      String   // → Customer
  reason          String
  refundAmount    Decimal  @db.Decimal(18, 4)
  refundTo        String                  // PAYMENT_METHOD | CUSTOMER_CREDIT | NONE
  posSessionId    String?  // → PosSession
  createdById     String?  // → User
  createdAt       DateTime @default(now())
  lines           ReturnLine[]
  @@unique([workspaceId, returnNumber])
}

model ReturnLine {                        // R3
  id          String  @id @default(cuid())
  workspaceId String
  returnId    String  // → Return
  orderItemId String  // → OrderItem
  quantity    Decimal @db.Decimal(18, 4)
  amount      Decimal @db.Decimal(18, 4)
  restock     Boolean @default(true)
}

// ═══ POS ═════════════════════════════════════════════════════════════════

model PosSession {
  id            String   @id @default(cuid())
  workspaceId   String
  cashierId     String   // → User
  locationId    String   // → InventoryLocation
  status        String   @default("OPEN") // OPEN | CLOSED
  openedAt      DateTime @default(now())
  closedAt      DateTime?
  openingFloat  Decimal  @default(0) @db.Decimal(18, 4)
  expectedClose Decimal? @db.Decimal(18, 4)
  actualClose   Decimal? @db.Decimal(18, 4)
  discrepancy   Decimal? @db.Decimal(18, 4)
  closeNote     String?
  closingData   Json?                     // snapshot of the daily closing report
  @@index([workspaceId, cashierId, status])
  // partial unique index (raw SQL in migration): one OPEN session per (workspaceId, cashierId)
}

model CashMovement {                      // R3
  id           String   @id @default(cuid())
  workspaceId  String
  posSessionId String   // → PosSession
  direction    String                     // IN | OUT
  amount       Decimal  @db.Decimal(18, 4)
  reason       String
  createdById  String?  // → User
  createdAt    DateTime @default(now())
}

model Receipt {
  id            String   @id @default(cuid())
  workspaceId   String
  receiptNumber String
  orderId       String   // → Order
  paymentId     String?  // → Payment
  type          String   @default("SALE") // SALE | PAYMENT | REFUND
  issuedAt      DateTime @default(now())
  data          Json                      // immutable snapshot
  reprintCount  Int      @default(0)
  @@unique([workspaceId, receiptNumber])
}

// ═══ Finance ═════════════════════════════════════════════════════════════

model FinancialAccount {
  id              String  @id @default(cuid())
  workspaceId     String
  type            String                  // CASH | BANK | MOBILE_WALLET | CARD_TERMINAL
  name            String
  bankName        String?
  accountTitle    String?
  accountNumber   String?
  branch          String?
  showToCustomers Boolean @default(false)
  active          Boolean @default(true)
  @@unique([workspaceId, name])
}

model PaymentMethod {
  id                String  @id @default(cuid())
  workspaceId       String
  name              String
  type              String                // CASH | CARD | BANK_TRANSFER | MOBILE_MONEY | OTHER
  accountId         String  // → FinancialAccount
  requiresReference Boolean @default(false)
  active            Boolean @default(true)
  @@unique([workspaceId, name])
}

model Payment {
  id              String   @id @default(cuid())
  workspaceId     String
  paymentNumber   String
  type            PaymentType
  status          PaymentStatus @default(CONFIRMED)
  orderId         String?  // → Order
  customerId      String?  // → Customer
  returnId        String?  // → Return
  paymentMethodId String?  // → PaymentMethod (null for CREDIT_APPLIED)
  accountId       String?  // → FinancialAccount
  amount          Decimal  @db.Decimal(18, 4)   // always positive; direction is given by type
  paidAt          DateTime @default(now())
  referenceNumber String?
  proofFileId     String?  // → FileAsset
  note            String?
  posSessionId    String?  // → PosSession
  recordedById    String?  // → User
  confirmedById   String?  // → User
  confirmedAt     DateTime?
  voidedById      String?  // → User
  voidedAt        DateTime?
  voidReason      String?
  createdAt       DateTime @default(now())
  @@unique([workspaceId, paymentNumber])
  @@index([workspaceId, orderId])
  @@index([workspaceId, customerId])
  @@index([workspaceId, status, paidAt])
}
enum PaymentType   { ORDER_PAYMENT DEPOSIT ADVANCE CREDIT_APPLIED REFUND }
enum PaymentStatus { PENDING_VERIFICATION CONFIRMED REJECTED VOIDED }

model CustomerCredit {                    // ledger; balance = SUM(amount)
  id          String   @id @default(cuid())
  workspaceId String
  customerId  String   // → Customer
  amount      Decimal  @db.Decimal(18, 4) // signed
  reason      String                      // ADVANCE | OVERPAYMENT | REFUND_TO_CREDIT | APPLIED | ADJUSTMENT
  paymentId   String?  // → Payment
  orderId     String?  // → Order
  createdById String?  // → User
  createdAt   DateTime @default(now())
  @@index([workspaceId, customerId])
}

model ExpenseCategory {
  id          String  @id @default(cuid())
  workspaceId String
  name        String
  active      Boolean @default(true)
  @@unique([workspaceId, name])
}

model Expense {
  id              String   @id @default(cuid())
  workspaceId     String
  categoryId      String   // → ExpenseCategory
  amount          Decimal  @db.Decimal(18, 4)
  expenseDate     DateTime
  paymentMethodId String   // → PaymentMethod
  accountId       String   // → FinancialAccount
  description     String?
  attachmentFileId String? // → FileAsset
  status          String   @default("POSTED") // POSTED | VOIDED
  voidReason      String?
  customFields    Json     @default("{}")
  recordedById    String?  // → User
  createdAt       DateTime @default(now())
  @@index([workspaceId, expenseDate])
}

// ═══ Commissions ═════════════════════════════════════════════════════════

model CommissionRule {
  id            String   @id @default(cuid())
  workspaceId   String
  name          String
  calcType      CommissionCalcType
  rate          Decimal  @db.Decimal(18, 4)
  baseType      CommissionBase @default(NET_SALES)
  scope         String   @default("ALL")  // ALL | CATEGORY | PRODUCT | ORDER_TYPE
  scopeId       String?                   // categoryId, productId or order type
  salespersonId String?  // → User; null = every salesperson
  priority      Int      @default(0)
  active        Boolean  @default(true)
  createdAt     DateTime @default(now())
}
enum CommissionCalcType { PERCENTAGE FIXED_PER_ORDER FIXED_PER_UNIT }
enum CommissionBase     { NET_SALES GROSS_SALES GROSS_PROFIT }

model Commission {
  id              String   @id @default(cuid())
  workspaceId     String
  orderId         String   // → Order
  orderItemId     String?  // → OrderItem
  salespersonId   String   // → User
  ruleId          String?  // → CommissionRule
  ruleSnapshot    Json                    // rule values at calculation time
  calculationBase Decimal  @db.Decimal(18, 4)
  sharePercent    Decimal  @default(100) @db.Decimal(9, 4)
  amount          Decimal  @db.Decimal(18, 4)   // negative for a partial reversal row
  status          CommissionStatus @default(PENDING)
  reversalOfId    String?  // → Commission
  approvedById    String?  // → User
  approvedAt      DateTime?
  paidAt          DateTime?
  paidMethod      String?
  note            String?
  createdAt       DateTime @default(now())
  @@index([workspaceId, salespersonId, status])
  @@index([workspaceId, orderId])
}
enum CommissionStatus { PENDING APPROVED REJECTED PAID REVERSED }

// ═══ Messaging and integrations ══════════════════════════════════════════

model IntegrationConnection {
  id                String   @id @default(cuid())
  workspaceId       String
  provider          String                // WHATSAPP | FACEBOOK_LEADS | INSTAGRAM | AI_<name> | SMTP | S3
  type              String                // CHANNEL | AI | EMAIL | STORAGE | PAYMENT
  status            String   @default("CONNECTED") // CONNECTED | DISCONNECTED | ERROR
  displayName       String?
  externalAccountId String?               // e.g. receiving phone number id or page id
  configEncrypted   String                // AES-256-GCM
  lastSuccessAt     DateTime?
  lastErrorAt       DateTime?
  lastError         String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@unique([workspaceId, provider])
  @@unique([provider, externalAccountId])
}

model WebhookEvent {                      // GLOBAL (workspace resolved after receipt)
  id           String   @id @default(cuid())
  provider     String
  dedupeKey    String
  workspaceId  String?
  connectionId String?
  kind         String                     // message | status | lead_form
  payload      Json
  status       String   @default("RECEIVED") // RECEIVED | PROCESSED | FAILED | IGNORED
  attempts     Int      @default(0)
  error        String?
  receivedAt   DateTime @default(now())
  processedAt  DateTime?
  @@unique([provider, dedupeKey])
  @@index([status, receivedAt])
}

model Conversation {
  id                String   @id @default(cuid())
  workspaceId       String
  connectionId      String   // → IntegrationConnection
  channelType       String
  externalContactId String
  contactName       String?
  contactPhone      String?
  customerId        String?  // → Customer
  leadId            String?  // → Lead
  assignedToId      String?  // → User
  status            String   @default("OPEN") // OPEN | PENDING | CLOSED
  unreadCount       Int      @default(0)
  automationActive  Boolean  @default(true)
  aiEnabled         Boolean  @default(true)
  needsHuman        Boolean  @default(false)
  needsHumanReason  String?
  lastMessageAt     DateTime?
  lastInboundAt     DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  @@unique([workspaceId, connectionId, externalContactId])
  @@index([workspaceId, status, lastMessageAt])
}

model Message {
  id                String   @id @default(cuid())
  workspaceId       String
  conversationId    String   // → Conversation
  externalId        String?
  direction         MessageDirection
  senderType        String                // CUSTOMER | STAFF | AI | AUTOMATION | SYSTEM
  senderUserId      String?  // → User
  type              String   @default("TEXT") // TEXT | IMAGE | DOCUMENT | AUDIO | VIDEO | LOCATION | TEMPLATE | UNSUPPORTED
  body              String?
  attachments       Json     @default("[]")   // [{ fileId, name, mime }]
  templateId        String?  // → MessageTemplate
  status            String   @default("QUEUED") // QUEUED | SENT | DELIVERED | READ | FAILED | RECEIVED
  failureReason     String?
  providerTimestamp DateTime
  channelMeta       Json?
  createdAt         DateTime @default(now())
  @@unique([workspaceId, conversationId, externalId])
  @@index([workspaceId, conversationId, providerTimestamp])
}
enum MessageDirection { INBOUND OUTBOUND }

model MessageTemplate {
  id             String   @id @default(cuid())
  workspaceId    String
  name           String
  kind           String                   // QUICK_REPLY | MESSAGE | PROVIDER | NOTIFICATION | BANK_DETAILS
  channel        String?
  body           String
  variables      String[]
  providerName   String?
  language       String?
  providerStatus String?                  // APPROVED | PENDING | REJECTED
  active         Boolean  @default(true)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@unique([workspaceId, kind, name])
}

// ═══ AI and automation ═══════════════════════════════════════════════════

model KnowledgeItem {
  id          String   @id @default(cuid())
  workspaceId String
  title       String
  body        String
  active      Boolean  @default(true)
  updatedAt   DateTime @updatedAt
}

model QuestionFlow {                      // R2
  id          String  @id @default(cuid())
  workspaceId String
  categoryId  String? // → Category; null = default flow
  steps       Json                        // [{ fieldKey, question }]
  @@unique([workspaceId, categoryId])
}

model AISuggestion {
  id             String   @id @default(cuid())
  workspaceId    String
  conversationId String?  // → Conversation
  leadId         String?  // → Lead
  type           String                   // EXTRACTION | DRAFT_REPLY | SUMMARY | CLASSIFICATION | NEXT_ACTION | NOTE | NEXT_QUESTION
  payload        Json
  flags          String[]
  confidence     Decimal? @db.Decimal(5, 4)
  status         String   @default("PENDING") // PENDING | APPROVED | EDITED | REJECTED | SUPERSEDED | AUTO_SENT
  decidedById    String?  // → User
  decidedAt      DateTime?
  appliedPayload Json?
  createdAt      DateTime @default(now())
  @@index([workspaceId, conversationId, createdAt])
}

model AIActionLog {
  id              String   @id @default(cuid())
  workspaceId     String
  conversationId  String?
  suggestionId    String?  // → AISuggestion
  actionType      String
  providerName    String
  modelVersion    String?
  promptVersion   String
  promptHash      String
  responseHash    String?
  inputTokens     Int      @default(0)
  outputTokens    Int      @default(0)
  latencyMs       Int?
  confidenceScore Decimal? @db.Decimal(5, 4)
  outcome         String                  // SUCCESS | FAILED | TIMEOUT | DISABLED | LIMIT_REACHED
  error           String?
  humanApproved   Boolean  @default(false)
  approvedById    String?  // → User
  approvedAt      DateTime?
  createdAt       DateTime @default(now())
  @@index([workspaceId, createdAt])
}

model AIUsage {
  id          String   @id @default(cuid())
  workspaceId String
  day         DateTime @db.Date
  requests    Int      @default(0)
  tokens      Int      @default(0)
  @@unique([workspaceId, day])
}

model AutomationRule {                    // R2
  id           String   @id @default(cuid())
  workspaceId  String
  name         String
  trigger      String
  conditions   Json     @default("{}")
  action       String
  actionParams Json
  enabled      Boolean  @default(true)
  maxRetries   Int      @default(0)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model AutomationLog {                     // R2
  id          String   @id @default(cuid())
  workspaceId String
  ruleId      String   // → AutomationRule
  trigger     String
  entityType  String?
  entityId    String?
  dedupeKey   String
  outcome     String                      // SUCCESS | FAILED | SKIPPED
  skipReason  String?
  error       String?
  attempts    Int      @default(1)
  createdAt   DateTime @default(now())
  @@unique([workspaceId, dedupeKey])
}

// ═══ Reporting and imports ═══════════════════════════════════════════════

model SavedReport {                       // R4
  id            String   @id @default(cuid())
  workspaceId   String
  name          String
  dataset       String
  definition    Json
  sharedRoleIds String[]
  createdById   String?  // → User
  createdAt     DateTime @default(now())
}

model BackgroundJobRecord {               // exports, large reports, imports, workspace export
  id          String   @id @default(cuid())
  workspaceId String
  kind        String                      // REPORT | EXPORT | IMPORT | WORKSPACE_EXPORT
  params      Json
  status      String   @default("QUEUED") // QUEUED | RUNNING | DONE | FAILED
  progress    Int      @default(0)
  resultFileId String? // → FileAsset
  summary     Json?                       // counts, row errors
  error       String?
  createdById String?  // → User
  createdAt   DateTime @default(now())
  finishedAt  DateTime?
}
```

### Indexes Added by Raw SQL in Migrations

- GIN on every `customFields` column used for filtering (`Product`, `Customer`, `Lead`, `Order`).
- GIN on `Customer.phonesNormalized`.
- `pg_trgm` GIN indexes for search: `Customer(fullName)`, `Lead(fullName, interest)`, `Product(name, code)`, `ProductVariant(sku, barcode)`, `Supplier(name)`, `Order(orderNumber)`, `Quotation(quotationNumber)`, `Conversation(contactName, contactPhone)`.
- Partial unique index: one `OPEN` `PosSession` per `(workspaceId, cashierId)`.
- Partial unique index: one `isWalkIn = true` Customer per workspace; one `isDefault = true` location per workspace.
- Trigger `audit_events_append_only` (blocks UPDATE and DELETE); trigger `stock_movements_append_only` (same).

---

## API

### Conventions

- Base path `/api/v1`. JSON only, except file upload (multipart) and document downloads (PDF).
- Success envelope: `{ "data": T, "meta"?: { "nextCursor"?: string, "total"?: number } }`.
- Error envelope: `{ "statusCode": number, "code": string, "message": string, "details"?: Record<string, string[]>, "requestId": string }`.
- Lists: `?limit=` (default 25, maximum 100), `?cursor=`, `?sort=field:asc|desc`, `?q=`, plus documented filters and `?cf.<fieldKey>=` for custom fields.
- Decimals are strings. Dates are ISO 8601 UTC.
- The workspace always comes from the token, never from the body or query.
- PATCH on versioned entities requires `version`.
- Every endpoint below requires authentication and the permission in brackets, except those marked public.

### Endpoints

```
Health (public)
  GET    /health/live
  GET    /health/ready

Auth
  POST   /auth/login                         (public)
  POST   /auth/select-workspace              (public, with login ticket)
  POST   /auth/switch-workspace
  POST   /auth/refresh                       (public, refresh token)
  POST   /auth/logout
  POST   /auth/password/forgot               (public)
  POST   /auth/password/reset                (public, token)
  POST   /auth/password/change
  GET    /auth/me                            (profile, workspace, permissions, terminology, modules)
  GET    /auth/sessions
  DELETE /auth/sessions/:id
  POST   /auth/invite/accept                 (public, token)

Tenants and settings
  POST   /tenants                            (public only when signup is enabled; else platform:admin)
  GET    /settings                           [workspace:view]
  PATCH  /settings                           [workspace:configure]
  GET    /settings/industry-profiles         [workspace:view]
  POST   /settings/apply-profile/:key        [workspace:configure]
  GET|POST|PATCH        /settings/units                 [workspace:configure]
  GET|POST|PATCH        /settings/tax-classes           [workspace:configure]
  GET|POST|PATCH        /settings/lost-reasons          [workspace:configure]
  GET|POST|PATCH        /settings/adjustment-reasons    [workspace:configure]
  GET|POST|PATCH        /settings/expense-categories    [workspace:configure]
  GET|POST|PATCH        /settings/financial-accounts    [account:view | account:configure]
  GET|POST|PATCH        /settings/payment-methods       [account:view | account:configure]
  GET|POST|PATCH        /settings/knowledge             [ai:control]

Users, staff and roles
  GET    /users                              [user:view]
  POST   /users/invite                       [user:create]
  GET    /users/:id                          [user:view]
  PATCH  /users/:id                          [user:edit]        (profile, roles, salesperson flag)
  POST   /users/:id/deactivate               [user:deactivate]
  POST   /users/:id/reactivate               [user:deactivate]
  POST   /users/:id/reset-link               [user:edit]
  GET    /roles                              [role:view]
  POST   /roles                              [role:configure]
  PATCH  /roles/:id                          [role:configure]
  DELETE /roles/:id?fallbackRoleId=          [role:configure]
  GET    /permissions                        [role:view]        (the catalogue)

Fields and workflows
  GET    /fields?entityType=                 [field:view]
  POST   /fields                             [field:configure]
  PATCH  /fields/:id                         [field:configure]
  GET    /workflows/:entityType              [workflow:view]
  PUT    /workflows/:entityType              [workflow:configure]   (R4)
  GET    /approvals                          [any *:approve]
  POST   /approvals/:id/decide               [matching *:approve]

Files
  POST   /files                              (authenticated; permission of the target entity)
  GET    /files/:id/url
  DELETE /files/:id

Audit
  GET    /audit/events                       [audit:view]

Catalog
  GET    /catalog/products                   [product:view]
  POST   /catalog/products                   [product:create]
  GET    /catalog/products/:id               [product:view]
  PATCH  /catalog/products/:id               [product:edit]
  POST   /catalog/products/:id/archive       [product:archive]
  POST   /catalog/products/:id/variants      [product:edit]
  PATCH  /catalog/variants/:id               [product:edit]
  POST   /catalog/products/:id/generate-variants   [product:edit]
  POST   /catalog/products/:id/images        [product:edit]
  DELETE /catalog/images/:id                 [product:edit]
  GET    /catalog/variants/lookup?code=      [product:view]
  GET    /catalog/variants/search?q=         [product:view]     (POS and line pickers; price and available stock)
  GET|POST|PATCH        /catalog/categories  [product:view | product:edit]
  GET|POST|PATCH        /catalog/brands      [product:view | product:edit]
  GET|POST|PATCH        /catalog/price-lists (R3)               [product:edit]

Inventory
  GET    /inventory/stock                    [inventory:view]   (levels; filters: location, category, low, over)
  GET    /inventory/movements                [inventory:view]
  POST   /inventory/opening-stock            [inventory:adjust]
  POST   /inventory/movements                [inventory:adjust] (adjustment in or out with reason)
  POST   /inventory/transfers                [inventory:transfer]   (R3)
  GET|POST /inventory/counts, POST /inventory/counts/:id/post   [inventory:count]   (R3)
  GET|POST|PATCH        /inventory/locations [inventory:view | workspace:configure]

Purchasing
  GET|POST /suppliers ; GET|PATCH /suppliers/:id ; POST /suppliers/:id/archive   [supplier:*]
  GET|POST /purchases ; GET|PATCH /purchases/:id                                 [purchase:view | create | edit]
  POST   /purchases/quick                    [purchase:receive] (create and receive in full)
  POST   /purchases/:id/status               [purchase:edit]
  POST   /purchases/:id/receive              [purchase:receive]
  POST   /purchases/:id/payments             [payment:create]   (R3)
  POST   /purchases/:id/returns              [purchase:return]  (R3)

CRM
  GET|POST /customers ; GET|PATCH /customers/:id ; POST /customers/:id/archive   [customer:*]
  GET    /customers/:id/timeline             [customer:view]
  GET    /customers/:id/finance              [payment:view]
  POST   /customers/:id/merge                [customer:merge]       (R3)
  GET    /customers/:id/export               [customer:export]      (R4)
  POST   /customers/:id/anonymize            [customer:anonymize]   (R4)
  GET|POST /leads ; GET|PATCH /leads/:id                                         [lead:*]
  POST   /leads/:id/stage                    [lead:edit]
  POST   /leads/:id/assign                   [lead:assign]
  POST   /leads/:id/convert                  [lead:edit]
  GET    /leads/:id/timeline                 [lead:view]
  GET    /leads/pipeline                     [lead:view]            (board columns with counts and values)
  GET|POST /tasks ; PATCH /tasks/:id ; POST /tasks/:id/complete                  [task:*]
  GET|POST /notes?entityType=&entityId=      (permission of the entity)
  GET    /search?q=

Quotations and orders
  GET|POST /quotations ; GET|PATCH /quotations/:id                               [quotation:*]
  POST   /quotations/:id/send                [quotation:send]
  POST   /quotations/:id/accept              [quotation:edit]
  POST   /quotations/:id/reject              [quotation:edit]
  POST   /quotations/:id/convert             [order:create]
  POST   /pricing/preview                    (authenticated; returns calculated totals for draft lines)
  GET|POST /orders ; GET|PATCH /orders/:id                                       [order:*]
  POST   /orders/:id/status                  [order:edit]
  PATCH  /orders/:id/fulfilment              [order:edit]
  GET    /orders/:id/timeline                [order:view]
  POST   /orders/:id/invoice                 [order:edit]
  GET|POST /returns ; GET /returns/:id       [payment:refund]       (R3)
  GET    /production/jobs ; PATCH /production/jobs/:id ; POST /production/jobs/:id/status   [production:*]   (R3)

Documents (PDF)
  GET    /documents/quotations/:id/pdf
  GET    /documents/orders/:id/confirmation/pdf
  GET    /documents/invoices/:id/pdf
  GET    /documents/receipts/:id/pdf?paper=58mm|80mm|A4&reprint=true
  GET    /documents/purchases/:id/pdf
  GET    /documents/returns/:id/pdf          (R3)

POS
  GET    /pos/sessions/current               [pos:sell]
  POST   /pos/sessions                       [pos:open_session]     (R3 explicit open)
  POST   /pos/sessions/:id/close             [pos:close_session]    (R3)
  POST   /pos/sessions/:id/cash-movements    [pos:cash_movement]    (R3)
  GET    /pos/sessions ; GET /pos/sessions/:id                      [pos:view_all_sessions or own]
  POST   /pos/checkout                       [pos:sell]             (Idempotency-Key required)
  GET    /pos/receipts                       [pos:sell]
  POST   /pos/returns                        [pos:refund]           (R3)

Payments and finance
  GET    /payments                           [payment:view]
  POST   /payments                           [payment:create]       (Idempotency-Key required)
  POST   /payments/:id/confirm               [payment:confirm]
  POST   /payments/:id/reject                [payment:confirm]
  POST   /payments/:id/void                  [payment:void]
  POST   /payments/:id/refund                [payment:refund]       (R3)
  POST   /customers/:id/credit/apply         [payment:create]
  GET    /payments/receivables-summary       [payment:view]
  GET    /payments/payables-summary          [payment:view]         (R3)
  GET|POST /expenses ; POST /expenses/:id/void                      [expense:*]

Commissions
  GET    /commissions                        [commission:view]
  POST   /commissions/:id/approve|reject     [commission:approve]
  POST   /commissions/:id/pay                [commission:pay]
  GET|POST|PATCH /commissions/rules          [commission:configure]
  GET    /staff/:userId/performance          [commission:view or report:view_all_staff]

Messaging and integrations
  GET    /webhooks/:provider                 (public; verification challenge)
  POST   /webhooks/:provider                 (public; signature verified)
  GET    /integrations                       [integration:view]
  POST   /integrations/:provider/connect     [integration:manage]
  POST   /integrations/:provider/test        [integration:manage]
  POST   /integrations/:provider/resync      [integration:manage]
  DELETE /integrations/:provider             [integration:manage]
  GET    /conversations                      [conversation:view]
  GET    /conversations/:id                  [conversation:view]
  GET    /conversations/:id/messages         [conversation:view]
  POST   /conversations/:id/messages         [conversation:reply]
  PATCH  /conversations/:id                  [conversation:assign | ai:control]   (assign, status, automationActive, aiEnabled, link customer)
  POST   /conversations/:id/read             [conversation:view]
  GET|POST|PATCH /templates                  [template:view | template:configure]

AI
  POST   /ai/conversations/:id/summarize     [ai:use]
  POST   /ai/conversations/:id/extract       [ai:use]
  POST   /ai/conversations/:id/draft-reply   [ai:use]
  POST   /ai/conversations/:id/classify      [ai:use]
  POST   /ai/conversations/:id/next-action   [ai:use]
  GET    /ai/suggestions?conversationId=     [ai:use]
  POST   /ai/suggestions/:id/apply           [ai:use]
  POST   /ai/suggestions/:id/reject          [ai:use]
  GET    /ai/logs                            [ai:view_logs]
  GET    /ai/usage                           [ai:control]

Automation (R2)
  GET|POST|PATCH|DELETE /automation/rules    [automation:view | automation:configure]
  GET    /automation/logs                    [automation:view]

Notifications
  GET    /notifications
  GET    /notifications/unread-count
  POST   /notifications/:id/read
  POST   /notifications/read-all
  GET|PUT /notifications/preferences         (R2)

Reports
  GET    /reports                            [report:view]          (catalogue the user may see)
  GET    /reports/dashboard                  [report:view]
  GET    /reports/:key                       [report:view (+ report:financial)]
  GET    /reports/:key/drilldown             [report:view (+ report:financial)]
  POST   /reports/:key/export                [report:export]
  GET    /jobs/:id                           (status of a background report, export or import)
  GET|POST|PATCH|DELETE /reports/saved       [report:build]         (R4)

Imports (R3)
  POST   /imports                            [import:run]
  GET    /imports/:id ; POST /imports/:id/commit
  GET    /imports/templates/:type

Platform (R4)
  GET|POST /platform/workspaces ; POST /platform/workspaces/:id/suspend|reactivate   [platform:admin]
```

Report keys: `sales-by-date`, `sales-by-product`, `sales-by-category`, `sales-by-salesperson`, `sales-history`, `orders-by-status`, `lead-pipeline`, `lead-conversion`, `lead-source-performance`, `top-customers`, `customer-balances`, `supplier-balances`, `purchases`, `expenses`, `profit-loss`, `stock-on-hand`, `stock-valuation`, `stock-movements`, `low-stock`, `commission-statement`, `salesperson-performance`, `payment-methods`, `account-movements`, `returns`, `pos-daily-closing`, `ai-automation-activity`, `channel-message-volume`, `user-activity`.

---

## Background Jobs

| Queue | Producer | Work | Retries |
|---|---|---|---|
| `channel.inbound` | webhook controller | process one `WebhookEvent` | 3, exponential |
| `channel.outbound` | `ConversationService` | send one message | 3, exponential; honours retry-after |
| `ai.process` | message-received listener, on-demand calls | run AI functions | 1 |
| `commission.calculate` | order status listener | calculate commissions | 3 |
| `report.generate` | reporting | large reports and exports | 1 |
| `import.run` | imports (R3) | process an import | 0 |
| `automation.evaluate` | event bus (R2) | evaluate and run rules | per rule |
| `email.send` | notifications, auth | send one email | 3 |
| `outbox.relay` | scheduler (R2) | relay `OutboxEvent` rows | continuous |

Schedulers (`@nestjs/schedule`): task due scan (5 min), quotation expiry (daily 00:10 workspace time), scheduled automation triggers (15 min, R2), retention purge (daily, R4), idempotency key cleanup (daily), failed-webhook alert (5 min).

Jobs that exhaust retries move to a `dead-letter` queue and publish `integration.failed` or log an alert. Every job payload carries `workspaceId`; the processor sets the workspace context before any database call.

---

## Error Handling

| Category | HTTP | Code examples | Behaviour |
|---|---|---|---|
| Validation | 400 | `VALIDATION_FAILED` | field-level `details`; no side effects |
| Unauthenticated | 401 | `TOKEN_EXPIRED`, `TOKEN_STALE`, `INVALID_CREDENTIALS`, `ACCOUNT_LOCKED` | BFF refreshes or redirects to login |
| Forbidden | 403 | `PERMISSION_DENIED`, `MODULE_DISABLED`, `CROSS_TENANT` | Audit_Event; generic message |
| Not found | 404 | `NOT_FOUND` | also used for records of other workspaces |
| Conflict | 409 | `STALE_VERSION`, `POSSIBLE_DUPLICATE`, `INSUFFICIENT_STOCK`, `IDEMPOTENCY_KEY_REUSED`, `SESSION_ALREADY_OPEN` | client shows a specific message |
| Too large | 413 | `FILE_TOO_LARGE` | |
| Business rule | 422 | `TRANSITION_NOT_ALLOWED`, `DISCOUNT_OVER_LIMIT`, `DEPOSIT_REQUIRED`, `BALANCE_DUE`, `PRODUCT_ARCHIVED`, `REFUND_EXCEEDS_PAID`, `FREEFORM_WINDOW_CLOSED`, `CONTACT_OPTED_OUT`, `UNRESOLVED_TEMPLATE_VARIABLE` | no side effects |
| Rate limited | 429 | `RATE_LIMITED` | `Retry-After` header |
| External failure | 502 / 503 | `EXTERNAL_SERVICE_FAILED`, `AI_UNAVAILABLE` | core functions continue |
| Unhandled | 500 | `INTERNAL_ERROR` | full error logged with `requestId`; safe message returned |

Adapter calls are wrapped once, in `AdapterRunner.run(provider, method, fn)`: timeout, retry policy, circuit breaker, error mapping to `ExternalServiceException(provider, normalizedCode)`, structured log, `recordAsync` audit, and update of `IntegrationConnection.lastSuccessAt` / `lastErrorAt`. Raw provider errors never reach an API response.

Rate limits (`@nestjs/throttler`): auth endpoints 10 per minute per IP; webhooks 600 per minute per provider; all other endpoints 300 per minute per user. Repeated security violations from one IP (20 in 10 minutes) block that IP for 15 minutes (R4).

---

## Correctness Properties

*A property is a statement that must hold for every valid input. Each has a property-based test (`fast-check`, at least 100 runs). Properties marked (integration) run against a real PostgreSQL database.*

**Property 1 — Tenant isolation (integration).** For any two workspaces A and B and any tenant-scoped model, a record created in A is never returned by any read, and never changed by any write, executed in B's context. *Validates 1.2, 1.3, 1.4, 20.1.*

**Property 2 — Server-side permission enforcement (integration).** For any route and any permission set that lacks the route's required permission, the response is 403 and no data changes. *Validates 2.5, 2.6.*

**Property 3 — Audit completeness (integration).** For any state-changing service call that commits, at least one Audit_Event exists with the actor, entity type, entity id and new state; for any call that rolls back, none exists. *Validates 4.1, 4.2, 4.6.*

**Property 4 — Audit and ledger are append-only (integration).** Any UPDATE or DELETE on `audit_events` or `stock_movements` fails at the database. *Validates 4.3, 7.1.*

**Property 5 — Stock level equals the ledger (integration).** After any sequence of inventory operations, for every variant and location `StockLevel.onHand = Σ StockMovement.quantityDelta` and `StockLevel.reserved = Σ active StockReservation.quantity`. *Validates 7.3, 37.9.*

**Property 6 — Reservation arithmetic.** Confirming an order with N units of a stock-tracked variant reduces `available` by exactly N and leaves `onHand` unchanged; cancelling restores `available`; delivering reduces `onHand` by N and leaves `available` unchanged. *Validates 7.4, 11.6, 11.7.*

**Property 7 — Balance consistency (integration).** For any order and any sequence of payment records, confirmations, voids, refunds and returns, `balanceDue = (totalAmount − returnedAmount) − (Σ confirmed non-refund payments − Σ confirmed refunds)`, and payments that are not `CONFIRMED` never change it. *Validates 11.5, 13.6, 40.5.*

**Property 8 — Commission arithmetic.** For any rule and line, the commission equals the formula of the rule's type and base multiplied by the share percent, rounded half-up; the sum over salespeople of an order line never exceeds the unsplit amount by more than one minor currency unit per salesperson. *Validates 14.1, 14.2, 41.3–41.5.*

**Property 9 — Message normalization.** For any valid provider payload, every normalized event has all required fields non-null and a deterministic `dedupeKey`. *Validates 15.1, 15.2.*

**Property 10 — Webhook idempotency and ordering (integration).** Delivering any multiset of events in any order, with any duplicates, yields the same final Conversations, Messages and statuses as delivering each event once in timestamp order. *Validates 15.5, 42.1, 42.2.*

**Property 11 — Custom field round-trip.** For any Field_Definition and any value valid for its type, validate → store → read returns an equal value; any value invalid for its type is rejected. *Validates 6.3, 26.3.*

**Property 12 — Financial visibility gate (integration).** For any user without `report:financial` or `product:view_cost`, no response body from any report, dashboard, product or order endpoint contains a revenue, cost, profit or payment figure. *Validates 13.8, 19.8.*

**Property 13 — Input safety (integration).** For any string, including strings containing quote characters, comment markers and SQL keywords, submitted to any text field: the request is accepted if it meets the field's length and type rules, the stored value equals the submitted value, and no other row changes. *Validates 20.2.* (Replaces the earlier "reject injection patterns" property.)

**Property 14 — Pricing arithmetic.** For any set of lines, discounts, tax rates and rounding settings: `total = Σ lineTotal + roundingAmount`; the allocated order discount sums exactly to the order discount; no line total is negative; tax-inclusive and tax-exclusive calculations of the same net price agree on the net amount. *Validates 35.3, 35.5, 35.6, 35.10.*

**Property 15 — Document numbers.** For any number of concurrent document creations of one type in one workspace, the issued numbers are unique and form a sequence with no gaps. *Validates 23.5, 54.5.*

**Property 16 — Idempotent creation (integration).** Sending the same request with the same `Idempotency-Key` any number of times, including concurrently, creates exactly one record and returns the same response. *Validates 54.1, 56.2.*

**Property 17 — No oversell (integration).** For any number of concurrent sales or confirmations against the same stock where negative stock is disallowed, the number of units sold or reserved never exceeds the units available. *Validates 37.5, 37.6.*

**Property 18 — Workflow integrity.** For any workflow configuration and any sequence of transition requests, a record's state is always a state of its workflow, every state change has a `StatusHistory` row, and a request with no matching transition changes nothing. *Validates 27.6, 27.10, 11.3.*

**Property 19 — AI grounding.** For any draft text and context pack, the validator flags the draft if and only if it contains a monetary amount or availability statement not present in the context pack; a flagged draft is never auto-sent. *Validates 43.5, 43.6, 18.10.*

**Property 20 — AI gate.** For any combination of workspace mode, module toggle, conversation toggle and usage counters in which AI is not permitted, no adapter call is made. *Validates 18.5, 18.6, 43.13.*

---

## Testing Strategy

| Layer | Tooling | Scope |
|---|---|---|
| Unit | Jest | `packages/calc` (pricing, commission, visibility), services with mocked collaborators, adapters' payload parsing |
| Property | fast-check | the 20 properties above |
| Integration | Jest + supertest + real PostgreSQL (a fresh schema per test file) | every controller: happy path, validation, permission denial, tenant isolation |
| Matrix | generated tests | every route × every default Role (53.3); every tenant model × two workspaces (53.4) |
| Reconciliation | integration on the seeded dataset | every report total equals the sum of its drill-down rows (53.5) |
| End-to-end | Playwright against the running stack | workflows A–D, login, permission-hidden navigation |
| AI evaluation | Jest with recorded and live modes | 20+ conversations, field accuracy ≥ threshold (43.16) |
| Load | k6 | 100 concurrent users on list, order create, POS checkout (21.1) — R4 |

Coverage floors: `packages/calc` 100%; tenant extension 100%; inventory, payments, commissions services 95%; auth 95%; overall API 80%.

A task is complete only when: its code is implemented, its listed tests exist and pass, `pnpm lint` and `pnpm typecheck` pass, the migration (if any) has a `rollback.sql`, and its checkbox is ticked in `tasks.md`.

---

## Environments and Deployment

| | Development | Testing | Production |
|---|---|---|---|
| Where | local machine | hosted platform (Render) | client's VPS |
| Web | `next dev` | web service | container |
| API + workers | `nest start --watch` | one web service, `WORKERS_IN_PROCESS=true` | `api` and `worker` containers |
| PostgreSQL | docker compose | managed PostgreSQL | container with volume, or managed |
| Redis | docker compose | managed key-value store | container |
| Files | MinIO (docker compose) | S3-compatible bucket | S3-compatible bucket |
| TLS / proxy | none | platform | Caddy reverse proxy |
| Backups | none | platform snapshots | daily `pg_dump` to off-server storage, 14-day retention |

Environment variables (validated at startup by `apps/api/src/config/env.ts`; the API exits when one is missing or invalid): `NODE_ENV`, `APP_ENV` (`development` | `testing` | `production`), `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `INTEGRATION_ENCRYPTION_KEY`, `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`, `MAX_UPLOAD_MB`, `WEB_ORIGIN`, `API_BASE_URL`, `WORKERS_IN_PROCESS`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `SMTP_URL` (optional), `SENTRY_DSN` (optional), `ALLOW_PUBLIC_SIGNUP`, `PLATFORM_AUTOMATION_ENABLED`, `SEED_ALLOW_PRODUCTION`. Web: `API_INTERNAL_URL`, `NEXT_PUBLIC_APP_NAME`.

Per-workspace secrets (channel access tokens, AI provider keys) are **not** environment variables; they are stored encrypted in `IntegrationConnection`.

Release procedure (testing and production): build images → run `prisma migrate deploy` as a release step → start new containers → readiness check → switch traffic. Rollback: redeploy the previous image and, if the migration is not backward compatible, run its `rollback.sql`. Production deployment happens only after R1 testing sign-off and is a task in R4 (it may be brought forward by agreement with the client).

---

## Explicit Exclusions in This Version

These are stated so that nothing is assumed: offline POS selling; camera barcode scanning; printer drivers or printer configuration; multi-currency; first-in-first-out stock valuation; two-factor authentication; third-party API keys; a payment provider integration (interface only); an accounting system integration; automatic area calculation; image understanding by the AI unless explicitly enabled; and every "future module" listed in Requirement 55.4.
