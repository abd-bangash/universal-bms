# Implementation Plan: Universal BMS

## Overview

Tasks are **vertical slices**: each module task set delivers schema, API, tests and screens together, so that something usable ships at the end of every phase. This replaces the earlier plan, which built every backend module first and all screens last, created tables after the code that needed them, and set up the job queue after the jobs that used it.

How to read this file:

- Every task is tagged with its release: **R1** (first release, 15 working days), **R2**, **R3**, **R4**. R1 tasks also carry the working day from `release-plan.md`.
- Execute tasks in numerical order. Never start a task whose earlier tasks in the same release are unticked.
- Sub-tasks numbered `N.1`, `N.2` are tests. They are **mandatory** unless marked `*`. Tests for money, stock, permissions and tenant isolation are never optional (Requirement 53.7).
- `_Requirements:_` lists the acceptance criteria the task implements. A task is complete only when those criteria are met, its tests pass, `pnpm lint` and `pnpm typecheck` pass, and any migration has a `rollback.sql`.
- An R1 task implements only what its bullets say. Where a requirement is only partly delivered in R1, the bullet says which part; the rest is a later-release task that names the same requirement.
- A foreign key that points to a model introduced by a later task is created as a plain nullable column in the earlier migration and gets its Prisma relation and database constraint in the task that introduces the target model. Each schema task lists only the models it adds; it also adds the relations that have just become possible.
- All code is TypeScript strict. Stack: Next.js App Router, NestJS, PostgreSQL, Prisma, BullMQ. Follow `design.md` exactly; where it is silent, stop and ask.

---

## Release 1

### Phase 0 — Project Setup `[R1 · Day 1]`

- [x] 1. Scaffold the monorepo
  - Create the pnpm workspace with Turborepo: `apps/web`, `apps/api`, `packages/types`, `packages/validators`, `packages/calc`, `packages/config`
  - Scaffold `apps/api` with NestJS (strict TypeScript) and `apps/web` with Next.js App Router, TypeScript and Tailwind CSS; add shadcn/ui, TanStack Query, react-hook-form, Zod and next-intl to `apps/web`
  - Shared `tsconfig.base.json`, ESLint and Prettier in `packages/config`; root scripts `dev`, `build`, `lint`, `typecheck`, `test`
  - Pin exact dependency versions; commit the lockfile
  - Copy the spec into `.kiro/specs/universal-bms/` and the steering files into `.kiro/steering/`
  - _Requirements: 25.1, 25.2, 25.3, 25.4_

- [x] 2. Development infrastructure and continuous integration
  - `docker-compose.yml` with PostgreSQL, Redis and MinIO; `.env.example` for both apps with every variable from `design.md`
  - `apps/api/src/config/env.ts`: validate all environment variables at startup; exit with a clear message when one is missing or invalid
  - CI workflow: install, lint, typecheck, unit and integration tests against a PostgreSQL service; secret scanning with `gitleaks`
  - _Requirements: 25.5, 52.1, 52.2, 52.8, 53.8, 20.7_

- [x] 3. API common layer
  - Global prefix `/api/v1`; `ResponseEnvelopeInterceptor`; `AllExceptionsFilter` producing the error envelope with `requestId` and no stack traces
  - Request id middleware; `pino` logger with redaction of passwords, tokens, secrets and authorization headers
  - Global `ValidationPipe` (whitelist, forbid unknown properties, transform); cursor pagination helper; decimal helpers in `common/money`
  - `helmet` security headers, CORS restricted to `WEB_ORIGIN`, `@nestjs/throttler` with the limits in `design.md`
  - `GET /health/live` and `GET /health/ready` (database check; Redis and storage checks added by the tasks that introduce them)
  - `@nestjs/swagger` OpenAPI document served at `/api/v1/docs` outside production
  - All timestamps stored and returned in UTC (ISO 8601); conversion to the workspace timezone happens only in the web app, documents and report date boundaries
  - _Requirements: 20.2, 20.3, 20.8, 20.9, 20.10, 48.12, 51.1, 51.2, 54.3, 54.4_

- [x] 4. Prisma base, workspace context and tenant-scoped client
  - `schema.prisma` generator and datasource; first migration creating the `pg_trgm` and `citext` extensions
  - `ClsModule` (nestjs-cls) carrying `workspaceId`, `userId`, `requestId`, IP and user agent
  - `PrismaService` exposing `scoped` (with `tenantExtension` exactly as in `design.md`) and `unscoped`; ESLint rule restricting `unscoped` to the allowed modules
  - Script generating `TENANT_MODELS` from `schema.prisma`; unit test failing when a model has no `workspaceId` and is not in `GLOBAL_MODELS`
  - All primary keys are `cuid()` strings; no sequential identifier is ever exposed
  - _Requirements: 1.2, 1.3, 20.1, 21.4, 54.9_
  - [x] 4.1 Property test — Property 1 (tenant isolation): generated for every tenant-scoped model as models are added; runs in CI from this task onward
    - _Requirements: 1.3, 1.4, 20.1, 53.4_

- [x] 5. Domain event bus and scheduler
  - `DomainEventBus` interface and the in-process implementation that dispatches after transaction commit (`design.md` D14); typed event names and payloads in `packages/types`
  - `@nestjs/schedule` set up; scheduler jobs set the workspace context per workspace they act on
  - _Requirements: 55.1, 21.5_

### Phase 1 — Foundation `[R1 · Day 1]`

- [x] 6. Schema: platform, identity and cross-cutting models
  - Add to `schema.prisma`: `Workspace`, `User`, `UserSession`, `PasswordResetToken`, `LoginAttempt`, `IndustryProfile`, `PlatformSetting`, `UserWorkspace`, `Role`, `UserWorkspaceRole`, `Invitation`, `AuditEvent`, `IdempotencyKey`, `DocumentSequence`, `FileAsset`, `FieldDefinition`, `Workflow`, `WorkflowState`, `WorkflowTransition`, `StatusHistory`, `ApprovalRequest`, `Unit`, `TaxClass`, `InventoryLocation`, `Task`, `Note`, `Notification`
  - Migration `core` with `rollback.sql`; raw SQL trigger `audit_events_append_only`; partial unique index for one default location per workspace
  - _Requirements: 1.2, 4.2, 4.3, 22.1, 22.2_
  - [x] 6.1 Property test — Property 4 (audit append-only)
    - _Requirements: 4.3_

- [x] 7. Audit module
  - `AuditService.record(tx, …)` (transactional, before/after diff with redaction) and `recordAsync` (retry 3 times, then error log with alert tag)
  - `GET /audit/events` with filters (entity, actor, action, date range), cursor pagination, permission `audit:view`
  - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7_
  - [x] 7.1 Property test — Property 3 (audit completeness, including rollback leaves no event)
    - _Requirements: 4.1, 4.6_

- [x] 8. Authentication module
  - Permission catalogue in `packages/types/src/permissions.ts` exactly as in `design.md`
  - `POST /auth/login`, `/auth/select-workspace`, `/auth/switch-workspace`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `GET|DELETE /auth/sessions`, `POST /auth/password/change`
  - RS256 access token (15 min) with payload from `design.md`; opaque refresh token hashed in `UserSession`, rotation with family revocation on reuse
  - `argon2id` hashing; password policy; lockout after 5 failures in 15 minutes via `LoginAttempt`
  - `JwtAuthGuard`, `PermissionGuard` with `@RequirePermission`, `@Public`, `permVersion` check returning 401 `TOKEN_STALE`
  - Audit every login success and failure with IP and user agent
  - No two-factor authentication in this version
  - Password reset: `POST /auth/password/forgot` and `/auth/password/reset` with single-use 60-minute token; when no email adapter is configured the token is delivered only through task 10's admin reset link
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 45.1, 45.2, 45.4, 45.5, 45.6, 45.7, 45.8, 45.9_
  - [x] 8.1 Integration tests: login, refresh rotation, reuse detection, expired and revoked refresh, lockout, stale permission version
    - _Requirements: 2.1, 2.2, 2.3, 45.4, 45.7_
  - [x] 8.2 Property test — Property 2 (permission enforcement) and the route scan that fails when a non-public route has no `@RequirePermission`
    - _Requirements: 2.5, 2.6, 53.3_

- [x] 9. Workspace creation, system defaults and the furniture industry profile
  - `IndustryProfileService.apply(workspaceId, key)` upserting terminology, module toggles, Field_Definitions, Workflows (states and transitions), Units, Categories, lost reasons, expense categories — never deleting business-added data
  - `prisma/seed/profiles/furniture.json` with the furniture Field_Definitions and default Lead, Order, Purchase_Order and Production_Job workflows from `design.md`
  - `TenantsService.createWorkspace` in one transaction: Workspace with validated default config, Owner user and membership, system Roles (all nine of Requirement 2.8 with `maxDiscountPercent`), profile applied, default Inventory_Location, numbering sequences; a `WorkspaceDefaultsRegistry` lets later modules add their own defaults to the same transaction (walk-in Customer in task 23, cash account and payment methods in task 39, adjustment reasons in task 45)
  - `POST /tenants` — allowed only for a Platform_Admin unless `ALLOW_PUBLIC_SIGNUP=true`; CLI command `workspace:create` for R1 use
  - _Requirements: 1.1, 1.2, 1.5, 1.6, 2.8, 2.9, 26.2, 27.1, 27.2, 28.3, 46.4, 50.1_
  - [x] 9.1 Integration test: creating a workspace produces every default listed in Requirement 50.1; applying the profile twice changes nothing the second time
    - _Requirements: 1.6, 50.1_

- [x] 10. Users, staff profiles, invitations and roles
  - `POST /users/invite` (72-hour token), `POST /auth/invite/accept`, `GET /users`, `GET|PATCH /users/:id` (staff profile fields, role assignment, salesperson flag, default location), deactivate and reactivate, `POST /users/:id/reset-link`
  - Deactivation revokes all sessions and bumps `permVersion`; historical records untouched
  - `GET /roles`, `POST /roles`, `PATCH /roles/:id` (name, permissions, `maxDiscountPercent`), `DELETE /roles/:id?fallbackRoleId=`; Owner role immutable; last Owner cannot be demoted, deactivated or removed
  - Any change to a member's roles or a role's permissions bumps `permVersion` of affected members; `GET /permissions` returns the catalogue
  - _Requirements: 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 41.1, 45.3, 45.7_
  - [x] 10.1 Integration tests: role deletion reassigns to fallback; last Owner protected; deactivation invalidates sessions; permission change takes effect on the next request
    - _Requirements: 3.4, 3.6, 3.7, 45.7_

- [x] 11. Settings module
  - `WorkspaceConfigSchema` (Zod) in `packages/validators` covering every key of `WorkspaceConfig` in `design.md`, with defaults
  - `SettingsService.get(path)` with per-request cache; `GET /settings`, `PATCH /settings` (validates the whole object, bumps `configVersion`, audits changed paths)
  - `ModuleEnabledGuard` with `@RequireModule('pos')` returning 403 `MODULE_DISABLED`
  - CRUD endpoints for units, tax classes, lost reasons, adjustment reasons, expense categories
  - `GET /settings/industry-profiles`, `POST /settings/apply-profile/:key`
  - _Requirements: 1.7, 5.1, 5.2, 5.3, 5.4, 28.1, 28.4, 55.2_
  - [x] 11.1 Unit tests: invalid config rejected with field paths; a module toggle takes effect on the next request
    - _Requirements: 5.3, 5.4_

- [x] 12. File storage module
  - `StorageAdapter` interface; `LocalDiskStorage` and `S3Storage` drivers selected by `STORAGE_DRIVER`
  - `POST /files` (multipart): size limit (413), content-sniffed allow-list, key scheme from `design.md`, thumbnail with `sharp`, `FileAsset` row
  - `GET /files/:id/url` (tenant and linked-entity permission check, 5-minute signed URL); `DELETE /files/:id` refused when referenced by an issued document or a Message
  - Readiness check includes storage
  - `FileAsset.entityType` and `entityId` link a file to a Product, Quotation, Order, Order line, Lead, Customer, Expense, Payment or Message; each owning module attaches and lists its files through `FilesService`
  - _Requirements: 34.1, 34.2, 34.3, 34.4, 34.5, 34.6, 34.7, 34.8, 48.2_
  - [x] 12.1 Integration tests: wrong content type rejected despite a valid extension; oversized file rejected; another workspace's file returns 404
    - _Requirements: 34.2, 34.3, 34.4_

- [x] 13. Web application shell
  - `(auth)` pages: `/login`, `/select-workspace`, `/invite/[token]`, `/reset-password`
  - BFF route `app/api/bff/[...path]/route.ts`: HTTP-only cookies, Bearer forwarding, silent refresh on `TOKEN_EXPIRED` and `TOKEN_STALE`, origin check on mutating requests; `middleware.ts` redirecting unauthenticated users and preserving the return URL
  - `(app)` layout: sidebar from the navigation registry (`lib/navigation.ts`) filtered by permission and module, header with workspace name, global search box placeholder, notification bell placeholder, user menu
  - `lib/`: typed API client, `usePermission`, `useTerminology` (`t('customer')`), currency, number and date formatters using workspace locale and timezone, TanStack Query setup
  - Shared components: `DataTable` (search, filters, sort, cursor pagination, loading, empty and error states), `FormShell` (inline validation, server error mapping, unsaved-changes warning, disabled submit while pending), `DynamicFields` (renders any Field_Definitions using the shared visibility evaluator), `MoneyInput`, `FileUpload`, `StatusBadge`, `ConfirmDialog`
  - All user-visible strings in `messages/en.json` through next-intl
  - _Requirements: 25.3, 49.1, 49.2, 49.4, 49.5, 49.6, 49.7, 49.10, 49.11, 49.12, 28.2_
  - [ ] 13.1* Playwright smoke test: login, navigation hidden without permission, session expiry returns to the same page
    - _Requirements: 49.2, 49.10_

- [x] 14. Settings and staff screens
  - `/settings/business` (profile, branding with logo upload, currency, timezone, numbering formats, tax on or off, document texts, receipt paper size)
  - `/settings/industry` (current profile and module toggles), reference lists (units, tax classes, lost reasons, adjustment reasons, expense categories)
  - `/staff` (list, invite, edit profile, assign roles, deactivate, generate reset link) and `/staff/roles` (create and edit roles with the permission catalogue grouped by resource, maximum discount percent)
  - `/settings/audit` audit log viewer with filters and before/after view
  - _Requirements: 1.7, 3.1, 3.3, 3.5, 4.4, 5.1, 5.3, 41.1_

- [x] 15. Testing environment deployment
  - `deploy/render.yaml`: web service, API service (`WORKERS_IN_PROCESS=true`), PostgreSQL; release command `prisma migrate deploy`; health check path
  - Seed command `seed:demo` creating the demo workspace with the furniture profile and one user per default Role (extended by later seed tasks); refuses to run when `APP_ENV=production` without `SEED_ALLOW_PRODUCTION=true`
  - `docs/deployment-testing.md`
  - _Requirements: 52.1, 52.3, 50.2, 50.3, 50.5_

- [x] 16. Checkpoint — foundation
  - Two workspaces created; each user sees only their own workspace's users, roles, settings and audit log
  - Every default Role can log in on the testing environment and sees only its permitted navigation
  - All tests pass. Stop and ask the user to review before continuing.

### Phase 2 — Products `[R1 · Day 2]`

- [x] 17. Schema: catalog
  - Add `Category`, `Brand`, `Product`, `ProductVariant`, `ProductImage`, `BundleComponent`, `PriceList`, `PriceListItem`; migration `catalog` with `rollback.sql`; GIN index on `Product.customFields`; trigram indexes on product name, code, SKU and barcode
  - _Requirements: 6.1, 6.2, 36.1, 22.1, 22.2_

- [x] 18. Custom fields engine
  - `packages/calc/src/fields.ts`: `validateCustomFields`, `isVisible`, `buildFieldSnapshot`, value shapes per type exactly as in `design.md`
  - `FieldsService` and `GET /fields?entityType=`, `POST /fields`, `PATCH /fields/:id` (key immutable after first use; deactivate instead of delete)
  - Helper used by every module to validate `customFields` on write and to parse `?cf.<key>=` filters into JSONB queries
  - _Requirements: 6.3, 6.5, 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7, 26.9, 28.7_
  - [x] 18.1 Property test — Property 11 (custom field round-trip and rejection of invalid values), plus unit tests for visibility conditions
    - _Requirements: 6.3, 26.3, 26.4_

- [x] 19. Catalog API
  - Categories (tree) and Brands CRUD; Products CRUD with nested variants and `customFields` validated against Product and Variant Field_Definitions for the category
  - Default variant created when none is given; `generate-variants`; SKU and barcode uniqueness per workspace returning 409
  - Archive with the rules in `design.md`; optimistic concurrency with `version`
  - `GET /catalog/variants/lookup?code=` and `GET /catalog/variants/search?q=` (name, SKU, barcode, alias; returns resolved price and available stock once inventory exists)
  - Images: attach, reorder, set primary, remove
  - `product:view_cost` gate omitting cost fields
  - _Requirements: 6.1, 6.2, 6.4, 6.5, 6.6, 6.7, 36.1, 36.2, 36.3, 36.4, 36.5, 36.6, 36.7, 36.8, 54.2, 54.7_
  - [x] 19.1 Integration tests: duplicate SKU and barcode rejected; archived product cannot be added to a new document; cost hidden without `product:view_cost`; default variant created
    - _Requirements: 6.6, 6.7, 36.3, 36.8_

- [x] 20. Products screens
  - `/products` list (search, category, brand, status filters, custom-field filters), `/products/[id]` form with images, variants table, furniture attributes through `DynamicFields`, aliases, visibility flags, minimum and maximum stock levels
  - `/products/categories` and `/products/brands`
  - _Requirements: 6.1, 6.2, 6.3, 36.1, 36.4, 36.5, 49.11_

- [ ] 21. Sample catalog seed
  - Extend `seed:demo`: at least 6 categories, 30 furniture products with variants, attributes, aliases and placeholder images
  - _Requirements: 50.2, 50.5_

- [ ] 22. Checkpoint — products
  - Create a product with custom size and material attributes, generate variants, upload an image, archive another product; verify from a second workspace that none is visible
  - Stop and ask the user to review.

### Phase 3 — Customers and Leads `[R1 · Day 3]`

- [ ] 23. Schema: CRM
  - Add `Customer`, `Lead`, `LostReason`, `TimelineEntry`; migration `crm` with `rollback.sql`; GIN on `phonesNormalized` and `customFields`; trigram indexes on names; partial unique index for one walk-in Customer per workspace
  - Workspace creation now creates the walk-in Customer
  - _Requirements: 8.1, 9.2, 12.10, 22.1, 22.2_

- [ ] 24. Customers API
  - CRUD with E.164 normalization, tags, addresses, assigned staff, `customFields`, archive, `version`
  - Duplicate detection by `duplicates.matchOn` returning 409 `POSSIBLE_DUPLICATE` with candidates unless `confirmDuplicate` is set
  - List filters: name, phone, email, tag, assigned staff, source, custom fields
  - `GET /customers/:id/timeline` from `TimelineEntry`; timeline listener subscribed to Domain_Events
  - `GET /customers/:id/finance` returning lifetime value, total paid, outstanding balance and credit (zeros until orders and payments exist)
  - _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 26.7, 54.2_
  - [ ] 24.1 Integration tests: same phone in different formats is detected as a duplicate; walk-in Customer cannot be edited or listed
    - _Requirements: 8.2, 12.10_

- [ ] 25. Workflow engine
  - `WorkflowService`: load workflow, `allowedTransitions`, `transition()` implementing the six steps in `design.md`, registration of pre-conditions and side effects per `(entityType, systemRole)`, `StatusHistory` writes
  - `GET /workflows/:entityType`; validation that required System_Roles exist (used by the R4 editor)
  - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.10, 9.1, 11.2_
  - [ ] 25.1 Property test — Property 18 (workflow integrity)
    - _Requirements: 27.6, 27.10_

- [ ] 26. Leads API
  - CRUD with all Lead fields of Requirement 9.2, `customFields` (furniture requirement fields), attachments (reference images)
  - `POST /leads/:id/stage` through `WorkflowService`; `LOST` requires a lost reason; `POST /leads/:id/assign`
  - Dedup window returning the existing open Lead
  - `POST /leads/:id/convert` to Customer (Quotation and Order targets are wired in tasks 34 and 35)
  - `GET /leads/pipeline` (columns per state with count and estimated value); "only mine" unless `lead:view_all`
  - Pipeline analytics query: count and value by stage, average time in stage from `StatusHistory`, conversion rate, top lost reasons
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 41.2_
  - [ ] 26.1 Integration tests: every stage change writes history; LOST without a reason is rejected; a second lead for the same phone inside the window returns the first
    - _Requirements: 9.3, 9.5, 9.7_

- [ ] 27. Tasks and notes API
  - Tasks CRUD, complete, "my tasks" filters (overdue, today, upcoming); Notes with call-log type
  - Setting a Lead's next action and date upserts its open follow-up Task
  - Scheduler: due scan every 5 minutes publishing `task.due`
  - _Requirements: 30.1, 30.2, 30.3, 30.5, 30.6, 30.7_

- [ ] 28. CRM screens
  - `/customers` list and `/customers/[id]` (details, custom fields, timeline, notes, tasks, finance summary, linked leads, orders and conversations)
  - `/leads` pipeline board with drag between allowed stages and a list view; `/leads/[id]` (requirements, reference images, stage history, tasks, notes, convert actions)
  - `/tasks` my tasks
  - Usable at 360 pixels wide
  - _Requirements: 8.1, 8.4, 8.5, 9.1, 30.3, 49.3_

- [ ] 29. Global search
  - `GET /search?q=` as designed, covering the entity types that exist so far and extended by later phases (orders, quotations, suppliers, conversations)
  - Header search box with grouped results and keyboard navigation
  - _Requirements: 31.1, 31.2, 31.3, 31.4_
  - [ ] 29.1 Integration test: results never include another workspace's records or entity types the user cannot view
    - _Requirements: 31.3_

- [ ] 30. Checkpoint — CRM
  - Extend `seed:demo` with 20 customers and 15 leads across stages
  - Create a lead with custom sofa requirements, move it through the pipeline, add a follow-up, convert to a customer; the timeline shows every step
  - Stop and ask the user to review.

### Phase 4 — Quotations and Orders `[R1 · Day 4]`

- [ ] 31. Schema: sales
  - Add `Quotation`, `QuotationItem`, `Order`, `OrderItem`, `OrderSalesperson`, `Invoice`, `ProductionJob`, `Return`, `ReturnLine`; migration `sales` with `rollback.sql`; indexes from `design.md`
  - _Requirements: 10.1, 11.4, 22.1, 22.2_

- [ ] 32. Pricing, discount and tax engine
  - `packages/calc/src/pricing.ts` implementing `calculateDocument` with the six rules in `design.md`
  - `PricingService.resolveUnitPrice` (R1: variant override, then product base price); discount-limit check against the user's Roles (R1: reject over limit); price override requires `order:price_override` and is audited
  - `POST /pricing/preview`
  - _Requirements: 35.1, 35.3, 35.4, 35.5, 35.6, 35.8, 35.9, 35.10_
  - [ ] 32.1 Property test — Property 14 (pricing arithmetic), plus worked-example unit tests for inclusive and exclusive tax
    - _Requirements: 35.3, 35.5, 35.6_

- [ ] 33. Document numbering
  - `NumberingService.next(tx, docType)` with row lock and the configured format
  - _Requirements: 10.2, 23.5, 54.5_
  - [ ] 33.1 Property test — Property 15 (unique, gap-free under concurrency)
    - _Requirements: 23.5, 54.5_

- [ ] 34. Quotations API
  - CRUD for a Customer or Lead with catalog and custom lines, `customFields` and `fieldSnapshot` per line, attachments, totals from the pricing engine, validity date from `quotationValidityDays`
  - `send` (records `sentAt`, `sentVia = MANUAL`, stores `sentSnapshot`), `accept` (records approval details), `reject` with reason
  - `convert` to Order in one transaction; Lead conversion target `QUOTATION`
  - Daily scheduler marking expired quotations
  - R1 edits a sent quotation in place with an Audit_Event; version history is task 108
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 26.8, 39.1, 39.2, 39.4_
  - [ ] 34.1 Integration tests: conversion preserves lines, prices, custom fields and attachments; an expired quotation cannot be converted
    - _Requirements: 10.4, 10.5_

- [ ] 35. Orders API
  - Create and edit (draft only for lines) with catalog and custom lines, order type, source, location, salesperson (`OrderSalesperson` 100 percent), fulfilment fields, notes, `customFields`, `version`; idempotency key on create
  - `POST /orders/:id/status` through `WorkflowService` with the pre-conditions of `design.md`: line and customer required for `CONFIRMED`; deposit rule before `IN_PRODUCTION`; zero balance or override before `COMPLETED`; cancel reason for `CANCELLED`
  - `depositRequired` computed from `sales.requiredDepositPercent` at confirmation
  - Stock side effects are registered by task 47; commission side effects by task 60
  - `GET /orders/:id/timeline`; "only mine" unless `order:view_all`; Lead conversion target `ORDER`; linked Lead moves to `WON` when the Order is confirmed
  - `PATCH /orders/:id/fulfilment`
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.8, 39.1, 39.2, 39.3, 39.5, 39.9, 39.10, 41.2, 41.3, 54.1, 54.2_
  - [ ] 35.1 Integration tests: disallowed transition returns 422 with allowed states; order cannot enter production below the required deposit; order with a balance cannot be completed without the override permission
    - _Requirements: 11.2, 39.5, 39.10_

- [ ] 36. Documents module: quotation, order confirmation and invoice PDFs
  - `DocumentRenderer` interface and `ReactPdfRenderer`; shared A4 layout (logo, business block, customer block, lines with field snapshot, totals, tax breakdown, terms, optional bank details block, footer)
  - `POST /orders/:id/invoice` creating an `Invoice` with number and immutable snapshot; automatic invoice on the configured System_Role
  - PDF endpoints for quotation, order confirmation and invoice; terminology and locale formatting applied
  - _Requirements: 23.2, 23.3, 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7_
  - [ ] 36.1 Unit tests: rendering the same snapshot twice produces the same text content; invoice cannot be modified after issue
    - _Requirements: 29.5, 29.6_

- [ ] 37. Sales screens
  - `/quotations` list, `/quotations/new` and `/quotations/[id]` with the shared line editor (product picker, custom line, per-line `DynamicFields`, reference image upload, live totals from `packages/calc`), send, accept, reject, convert, open PDF
  - `/orders` list with status and payment-status filters; `/orders/[id]` with status control showing only allowed transitions, status timeline, lines, fulfilment panel, payments panel (wired in task 43), documents, notes and tasks
  - _Requirements: 10.1, 11.1, 11.3, 39.2, 39.9, 49.4, 49.5_

- [ ] 38. Checkpoint — quotations and orders
  - Extend `seed:demo` with 10 quotations and 15 orders across statuses
  - Workflow D steps 1 to 5 and workflow B steps 1 to 5 and 7: lead → quotation with custom sofa line → acceptance recorded → order → confirmed; PDFs open
  - Stop and ask the user to review.

### Phase 5 — Payments and Finance `[R1 · Day 5]`

- [ ] 39. Schema: finance
  - Add `FinancialAccount`, `PaymentMethod`, `Payment`, `CustomerCredit`, `ExpenseCategory`, `Expense`, `Receipt`; migration `finance` with `rollback.sql`
  - Workspace creation now creates a cash account and default payment methods (cash, bank transfer, card, mobile money)
  - _Requirements: 13.1, 13.3, 40.1, 40.3, 22.1, 22.2_

- [ ] 40. Payments API
  - Financial accounts and payment methods CRUD (`account:configure`); customer-facing flag
  - `POST /payments` (idempotent): order payment, deposit or advance; created `CONFIRMED` when the user has `payment:confirm`, otherwise `PENDING_VERIFICATION`; reference number required when the method demands it
  - `confirm`, `reject`, `void` (reason required, `payment:void`); no edit endpoint for confirmed payments
  - `recalculateOrder` exactly as in `design.md`, run in every transaction that changes a payment; `paymentStatus` derivation; automatic entry to the `Deposit paid` state
  - Advance to `CustomerCredit`; apply credit to an order; move an overpayment to credit
  - Payment receipt (`Receipt` type `PAYMENT`) with number and snapshot
  - Payment timeline per customer and per order; all changes audited with old and new values
  - _Requirements: 11.5, 13.1, 13.4, 13.6, 13.7, 13.8, 13.10, 27.9, 40.1, 40.2, 40.3, 40.4, 40.5, 40.7, 40.8, 40.9, 54.1, 54.6_
  - [ ] 40.1 Property test — Property 7 (balance consistency over random sequences of record, confirm, void and credit operations)
    - _Requirements: 11.5, 13.6, 40.5_
  - [ ] 40.2 Property test — Property 16 (idempotent creation) on `POST /payments`
    - _Requirements: 54.1_

- [ ] 41. Expenses API
  - Expense categories CRUD; `POST /expenses` with category, amount, date, method, account, description and attachment; `POST /expenses/:id/void` with reason; list with date and category filters
  - _Requirements: 13.3, 13.9, 13.10_

- [ ] 42. Receivables and bank details
  - `GET /payments/receivables-summary` per customer: invoiced, paid, outstanding
  - Bank details block on quotation, order confirmation and invoice PDFs from customer-facing accounts; `{{bank_details}}` template variable resolver
  - _Requirements: 13.4, 40.2, 40.11, 29.2_

- [ ] 43. Finance screens
  - `/finance/payments` list and record-payment dialog (also embedded in the order page), confirm, reject and void actions gated by permission
  - `/finance/expenses`, `/finance/receivables`, `/finance/accounts` (accounts and payment methods)
  - Order page: payments panel, deposit required, paid, balance, payment status
  - _Requirements: 13.1, 13.3, 13.4, 13.8, 40.3, 40.9_

- [ ] 44. Checkpoint — payments
  - Extend `seed:demo` with payments and 10 expenses
  - Workflow B steps 6 and 10: record a deposit, order moves to Deposit paid, record the balance, order can be completed; voiding a payment restores the balance
  - A user without financial permissions sees no payment or expense data
  - Stop and ask the user to review.

### Phase 6 — Inventory `[R1 · Day 6]`

- [ ] 45. Schema: inventory
  - Add `StockMovement`, `StockLevel`, `StockReservation`, `AdjustmentReason`, `StockCount`, `StockCountLine`; migration `inventory` with `rollback.sql`; trigger `stock_movements_append_only`; adjustment reasons registered as workspace defaults
  - _Requirements: 7.1, 7.2, 37.9, 22.1, 22.2_

- [ ] 46. Inventory API
  - `InventoryService.post` as the single ledger writer: row locks in fixed order, negative-stock rule, `StockLevel` update, weighted average cost update, `stock.low` event when crossing the minimum level
  - `POST /inventory/opening-stock` and `POST /inventory/movements` (adjustment in or out with reason and note), both idempotent
  - `GET /inventory/stock` (on hand, reserved, available, average cost, low and overstock flags) and `GET /inventory/movements` with all filters
  - Locations CRUD (R1 uses the single default location; the schema and API accept more)
  - Unit conversion to base unit applied on every posting
  - _Requirements: 7.1, 7.2, 7.3, 7.5, 28.5, 28.6, 37.1, 37.2, 37.5, 37.7, 37.9, 37.10, 37.11, 54.1, 54.6, 55.3_
  - [ ] 46.1 Property test — Property 5 (stock level equals ledger) and Property 4 for `stock_movements`
    - _Requirements: 7.3, 37.9_
  - [ ] 46.2 Property test — Property 17 (no oversell under concurrency)
    - _Requirements: 37.5, 37.6_

- [ ] 47. Reservations wired to the order workflow
  - `reserve`, `release`, `fulfil` as in `design.md`; registered as side effects of Order `CONFIRMED`, `CANCELLED` and `DELIVERED`
  - `OrderItem.stockTracked` set at line creation; `costPrice` snapshot written at fulfilment
  - Insufficient stock on confirmation returns 409 `INSUFFICIENT_STOCK` listing the lines
  - Product search now returns available quantity
  - _Requirements: 7.4, 11.6, 11.7, 37.8, 27.3_
  - [ ] 47.1 Property test — Property 6 (reservation arithmetic)
    - _Requirements: 7.4, 11.6, 11.7_

- [ ] 48. Inventory screens
  - `/inventory` stock table with low-stock and overstock filters; `/inventory/movements`; `/inventory/adjust` (opening stock and adjustments with reason); `/inventory/locations`
  - Low-stock count on the home page placeholder
  - _Requirements: 7.5, 37.1, 37.2, 37.10_

- [ ] 49. Checkpoint — inventory
  - Extend `seed:demo` with opening stock for every stockable variant
  - Enter opening stock, confirm an order (available drops, on hand unchanged), deliver it (on hand drops), cancel another (available restored); an adjustment without a reason is rejected
  - Stop and ask the user to review.

### Phase 7 — Point of Sale `[R1 · Day 7]`

- [ ] 50. Schema: POS
  - Add `PosSession`, `CashMovement`; partial unique index for one open session per cashier; migration `pos` with `rollback.sql`
  - _Requirements: 12.1, 22.1, 22.2_

- [ ] 51. POS API
  - `GET /pos/sessions/current` opening the cashier's session automatically for the day and location in R1 (explicit open with float, close and reconciliation are task 100)
  - `POST /pos/checkout` (idempotency key required) implementing the eight steps in `design.md`: R1 one payment method per sale, change for cash, walk-in or selected customer, salesperson defaulting to the cashier, line and order discounts with limit check, optional cash rounding
  - `GET /pos/receipts` (search by number, date, customer); reprint increments `reprintCount` and audits
  - _Requirements: 12.1, 12.2, 12.4, 12.5, 12.10, 12.11, 12.12, 12.13, 12.14, 35.7, 54.1, 54.8, 56.2, 56.3_
  - [ ] 51.1 Integration test: a failure injected at any step leaves no order, payment, movement or receipt; payment less than the total is rejected
    - _Requirements: 12.2, 54.8_
  - [ ] 51.2 Property test — Property 16 on `POST /pos/checkout` (repeated and concurrent identical keys create one sale)
    - _Requirements: 54.1, 56.2_

- [ ] 52. Receipt PDFs
  - Receipt layouts for 80mm, 58mm and A4 rendered from `Receipt.data`; all fields of Requirement 12.5; logo and footer from settings; "REPRINT" mark on reprints
  - `GET /documents/receipts/:id/pdf?paper=`
  - _Requirements: 12.5, 12.6, 23.1, 23.2, 23.3, 29.8, 48.5, 56.3, 56.4_

- [ ] 53. POS screen
  - `/pos`: keyboard-first product search and barcode-scanner input, cart with quantity, price, line discount, order discount and tax, customer picker with walk-in default, salesperson picker, payment dialog with tendered amount and change, receipt opened in the browser PDF viewer for printing
  - Blocking notice and retry with the same idempotency key when the API cannot be reached; cart kept on screen
  - `/pos/receipts` history with reprint
  - Usable at 768 pixels and above
  - _Requirements: 12.4, 12.11, 12.12, 49.3, 49.8, 49.9, 56.1, 56.2, 56.4, 56.5_

- [ ] 54. Checkpoint — POS
  - Workflow C steps 2 to 9: walk-in sale, stock deducted, payment recorded, receipt printed at 80mm and A4, reprint marked
  - Double-clicking Pay creates one sale
  - Stop and ask the user to review.

### Phase 8 — Suppliers and Purchasing `[R1 · Day 8]`

- [ ] 55. Schema: purchasing
  - Add `Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `GoodsReceipt`, `SupplierPayment`, `SupplierReturn`; migration `purchasing` with `rollback.sql`
  - _Requirements: 7.8, 22.1, 22.2_

- [ ] 56. Suppliers and purchasing API
  - Suppliers CRUD with archive and `customFields`; supplier purchase history
  - Purchase orders: create, edit draft, status through `WorkflowService`, expected date, per-item cost
  - `POST /purchases/:id/receive` (idempotent, partial or full) creating a `GoodsReceipt` and `PURCHASE_RECEIPT` movements with unit cost; over-receipt rejected
  - `POST /purchases/quick` creating and fully receiving in one transaction
  - Purchase order PDF
  - _Requirements: 7.8, 7.9, 37.7, 27.1, 29.1, 54.1_
  - [ ] 56.1 Integration tests: partial then final receipt sets Partially received then Received; average cost updates as specified
    - _Requirements: 7.9, 37.7_

- [ ] 57. Purchasing screens
  - `/purchasing/suppliers`, `/purchasing/orders` list, quick purchase form, purchase order detail with receive dialog
  - Suppliers added to global search
  - _Requirements: 7.8, 7.9, 31.1_

- [ ] 58. Checkpoint — purchasing
  - Extend `seed:demo` with 5 suppliers and 5 purchases
  - Record a quick purchase; stock and average cost update; the movement list shows the receipt
  - Stop and ask the user to review.

### Phase 9 — Commissions and Activity Log `[R1 · Day 9]`

- [ ] 59. Schema: commissions
  - Add `CommissionRule`, `Commission`; migration `commissions` with `rollback.sql`
  - _Requirements: 14.3, 22.1, 22.2_

- [ ] 60. Commission engine
  - `packages/calc/src/commission.ts`: rule selection by the precedence of Requirement 41.4, base calculation, amount by rule type, share percent, rounding
  - `CommissionService.calculateForOrder` on the configured trigger System_Role and immediately for POS sales; unique per order, salesperson and line
  - Reversal on Order `CANCELLED`
  - Approve, reject and pay endpoints with permissions; rules CRUD; staff profile "commission percent" writing a salesperson-scoped rule
  - Commission statement query (by salesperson, date range, status); "only mine" unless `commission:view_all`
  - `GET /staff/:userId/performance`
  - _Requirements: 12.9, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 41.4, 41.5, 41.6, 41.7_
  - [ ] 60.1 Property test — Property 8 (commission arithmetic) and unit tests for rule precedence
    - _Requirements: 14.1, 14.2, 41.4, 41.5_
  - [ ] 60.2 Integration tests: completing an order creates pending commissions; cancelling reverses them; a salesperson cannot see another's commissions
    - _Requirements: 14.2, 14.6, 41.7_

- [ ] 61. Commission, performance and activity screens
  - `/staff/commissions` (statement, approve, reject, mark paid), commission percent on the staff profile, `/staff/performance`
  - Activity tab on order, payment and product pages showing that record's Audit_Events
  - _Requirements: 14.4, 14.5, 14.7, 41.6, 4.4_

- [ ] 62. Checkpoint — commissions
  - Set a percentage for a salesperson, complete an order and a POS sale, approve and pay the commission; cancel an order and see the reversal
  - Stop and ask the user to review.

### Phase 10 — Dashboard and Reports `[R1 · Day 10]`

- [ ] 63. Reporting framework and R1 reports
  - `ReportDefinition` structure, generic controller (`GET /reports`, `/reports/:key`, `/reports/:key/drilldown`) and the financial-column stripping rule
  - R1 report definitions: `sales-by-date`, `sales-by-product`, `sales-by-category`, `sales-by-salesperson`, `sales-history`, `orders-by-status`, `lead-pipeline`, `lead-conversion`, `customer-balances` (with ageing), `payment-methods`, `stock-on-hand`, `low-stock`, `stock-movements`, `commission-statement`, `expenses`, `purchases`
  - All date boundaries in the workspace timezone; date-range filter on every report
  - _Requirements: 19.2, 19.4, 19.5, 19.8, 44.1, 44.2, 44.4_
  - [ ] 63.1 Property test — Property 12 (financial visibility gate)
    - _Requirements: 13.8, 19.8_
  - [ ] 63.2 Reconciliation test on the seeded dataset: every R1 report total equals the sum of its drill-down rows
    - _Requirements: 19.4, 53.5_

- [ ] 64. Dashboard API
  - `GET /reports/dashboard` returning indicators filtered by permission: sales today, this week and this month; open orders by status; lead funnel; low-stock count; outstanding balances; pending commissions; my tasks due
  - _Requirements: 19.1, 44.5_

- [ ] 65. Exports
  - `POST /reports/:key/export` as streamed CSV, requiring `report:export`, with an Audit_Event recording user, report, filters and time
  - _Requirements: 19.6, 19.7_

- [ ] 66. Dashboard and reports screens
  - Home page with indicator cards, alerts and my tasks; `/reports` catalogue and one generic report page with filters, totals, drill-down and export
  - _Requirements: 19.1, 19.2, 19.4, 49.1_

- [ ] 67. Checkpoint — day 10: core system
  - Workflows B, C and D run end to end on the testing environment with the demo data
  - Reports match source records; a user without financial permissions sees no money figures anywhere
  - All R1 tests so far pass in CI
  - Stop and ask the user to confirm the core system before starting messaging.

### Phase 11 — Messaging `[R1 · Days 11–12]`

- [ ] 68. Queue infrastructure
  - Redis connection and BullMQ; queues `channel.inbound`, `channel.outbound`, `ai.process`, `commission.calculate`, `report.generate`, `email.send`, and a dead-letter queue
  - `WORKERS_IN_PROCESS` switch; processors set the workspace context from the job payload; readiness check includes Redis
  - Move commission calculation to the queue; add the key-value store to `deploy/render.yaml`
  - _Requirements: 21.5, 51.1, 52.1_

- [ ] 69. Schema: messaging and AI
  - Add `IntegrationConnection`, `WebhookEvent`, `Conversation`, `Message`, `MessageTemplate`, `ContactConsent`, `KnowledgeItem`, `QuestionFlow`, `AISuggestion`, `AIActionLog`, `AIUsage`; migration `messaging_ai` with `rollback.sql`; trigram indexes on conversation contact fields
  - _Requirements: 15.2, 16.1, 18.8, 22.1, 22.2_

- [ ] 70. Integration connections
  - `IntegrationService`: connect (encrypt secrets with AES-256-GCM), test, disconnect, masked reads, status and last-error tracking
  - `AdapterRunner.run` (timeout, retry, circuit breaker with `cockatiel`, error mapping, logging, audit)
  - Endpoints under `/integrations`; `/integrations` screen showing status, last success, last error and a test button
  - _Requirements: 24.3, 24.4, 24.5, 42.12, 48.1, 48.6, 48.8, 48.9, 48.10, 21.3_
  - [ ] 70.1 Unit tests: secrets never appear in any API response or log; an adapter exception surfaces as a normalized error
    - _Requirements: 24.4, 42.12, 48.6_

- [ ] 71. Channel adapter framework and WhatsApp adapter
  - `ChannelAdapter` interface and `NormalizedEvent` types in `packages/types`; `ChannelRegistry`
  - `WhatsAppAdapter` for the WhatsApp Business Platform Cloud API: challenge verification, signature verification on the raw body, account id extraction, parsing of message and status events (text, image, document, audio, video, location, unsupported), free-form window check, send text, media and template messages, media download, connection test
  - Recorded sample payloads as test fixtures
  - _Requirements: 15.1, 15.4, 15.7, 24.1, 24.3, 42.3, 42.4, 48.1, 48.7_
  - [ ] 71.1 Property test — Property 9 (normalization completeness) over the fixtures and generated variations
    - _Requirements: 15.1, 15.2_

- [ ] 72. Webhook ingestion pipeline
  - `GET` and `POST /webhooks/:provider` as in `design.md`: raw body, signature check, workspace resolution by account id, durable `WebhookEvent` insert with dedupe key, enqueue, then acknowledge
  - `ChannelInboundProcessor` for message and status events: conversation upsert, identity matching by normalized phone to Customer, then open Lead, else new Lead; message insert; media to storage; counters; reopen closed conversations; forward-only status rank; retry on unknown message for out-of-order statuses
  - Three retries with backoff, then `FAILED`, audit and `integration.failed`
  - _Requirements: 15.2, 15.3, 15.5, 15.6, 15.7, 15.8, 15.9, 42.1, 42.2, 42.3, 42.11, 42.13_
  - [ ] 72.1 Property test — Property 10 (idempotency and ordering) delivering shuffled, duplicated event sets
    - _Requirements: 15.5, 42.1, 42.2_
  - [ ] 72.2 Integration tests: invalid signature returns 401 and is audited; unknown account is acknowledged and ignored; an inbound message from an unknown number creates a lead and a linked conversation
    - _Requirements: 15.3, 15.7, 15.8_

- [ ] 73. Conversations and outbound messaging
  - `GET /conversations` (filters: status, assigned, unread, needs human; "only mine" unless `conversation:view_all`), messages list, mark read, `PATCH` for assignment, status, link to customer, automation and AI toggles
  - `POST /conversations/:id/messages`: text, attachments (product images, quotation, invoice and receipt PDFs), quick reply or template; free-form window rule; queue to `channel.outbound`; staff send sets `automationActive = false`
  - Templates CRUD (quick replies, message templates, bank-details template) with variable resolution and the unresolved-variable guard
  - Workspace-level automation toggle respected
  - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 40.11, 42.4, 42.10, 42.11, 42.13_
  - [ ] 73.1 Integration tests: sending outside the free-form window without an approved template returns 422; a staff reply turns automation off for that conversation
    - _Requirements: 16.5, 42.4_

- [ ] 74. Inbox screens
  - `/conversations` two-pane inbox with unread indicators and filters; thread view with delivery status ticks, media preview, composer with quick replies, templates and attachment picker (including "send quotation" and "send bank details")
  - Customer or lead side panel with link, create-lead and open-order actions; conversation tab on customer and lead pages; conversations in global search
  - Usable at 360 pixels wide
  - _Requirements: 16.2, 16.3, 16.4, 42.10, 49.3, 31.1_

- [ ] 75. Checkpoint — messaging
  - On Meta's test number or the client's number: an inbound message creates a lead and conversation; a reply arrives on the phone; delivery status updates; a duplicate webhook creates nothing; a quotation PDF is sent
  - Workflow A steps 1 to 5 and 9 to 11
  - Stop and ask the user to review.

### Phase 12 — AI Assistant `[R1 · Day 13]`

- [ ] 76. AI adapter framework and first provider
  - `AIAdapter` interface (`generateStructured`, `generateText`) and `AIRegistry`; one provider adapter for the provider the client supplies a key for; a deterministic `FakeAIAdapter` for tests
  - Provider key stored through `IntegrationService`
  - _Requirements: 18.1, 18.2, 24.2, 24.3, 48.2, 48.8_

- [ ] 77. AI service
  - Gate (mode, module, conversation toggle, usage limits) making no call when not permitted
  - `ContextBuilder` producing the context pack exactly as in `design.md`; product candidate search limited to AI-visible products
  - Functions: `summarize`, `extractRequirements` (fields, missing fields, product candidates), `classifyLead`, `draftReply`, `suggestNextAction`, `generateNote`; prompts in `modules/ai/prompts` with `promptVersion`
  - Deterministic validators: schema, value-present-in-conversation confidence rule, amount and availability check against the context pack, forbidden-intent check
  - `AISuggestion` and `AIActionLog` persistence; `AIUsage` counters and limits
  - Escalation rules setting `needsHuman` and publishing `ai.escalated`
  - `ASSIST` trigger: debounced job after inbound messages; on-demand endpoints; `apply` and `reject` endpoints writing to Lead or Customer only on approval, with source and approver recorded
  - Knowledge items CRUD
  - Provider failure or timeout: no suggestion, conversation flagged, logged
  - _Requirements: 18.1, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 43.1, 43.2, 43.4, 43.5, 43.6, 43.7, 43.8, 43.10, 43.11, 43.12, 43.13, 43.14, 43.15_
  - [ ] 77.1 Property test — Property 19 (grounding validator) and Property 20 (gate makes no adapter call)
    - _Requirements: 18.5, 18.6, 43.5, 43.6, 43.13_
  - [ ] 77.2 Unit tests: nothing is written to a lead before approval; a draft containing a price absent from the context pack is flagged; low confidence sets `needsHuman`
    - _Requirements: 18.4, 18.9, 18.10_

- [ ] 78. AI screens
  - Conversation side panel: summary, extracted requirements with per-field confidence and missing fields, product candidates, suggested next action, draft reply with edit, send and reject; flags shown clearly
  - `/automation/ai`: mode (R1 offers `OFF` and `ASSIST`), tone, language, reply length, confidence threshold, escalation keywords, usage and limits, knowledge items, data-handling summary
  - `/automation/templates`; AI log viewer; per-conversation AI toggle and "needs human" indicator in the inbox
  - _Requirements: 18.5, 18.6, 18.8, 43.7, 43.8, 43.9, 47.5_

- [ ] 79. AI evaluation set and data-handling document
  - At least 20 synthetic furniture conversations with expected extraction in `apps/api/test/ai-eval/`; test runs against the fake adapter in CI and against the live provider on demand, reporting field accuracy against the threshold
  - 10 of these conversations loaded by `seed:demo`
  - `docs/ai-data-handling.md` listing every field sent to the provider
  - _Requirements: 43.16, 47.5, 50.2, 53.1_

- [ ] 80. Checkpoint — AI
  - The example from the source specification ("one L-shaped sofa, about 8 feet, brown leather, same design as this picture") yields product, quantity, length, material, colour and "reference image attached", with missing fields listed; approving it fills the lead
  - Turning AI off stops all provider calls
  - Workflow A complete
  - Stop and ask the user to review.

### Phase 13 — Release 1 Hardening and Acceptance `[R1 · Days 14–15]`

- [ ] 81. In-app notifications
  - `NotificationService` listening to: lead assigned, inbound message on an assigned conversation, task due, low stock, AI escalation, integration failure; recipient resolution; default preferences
  - Endpoints for list, unread count, mark read and read all; bell with polling and list in the header
  - _Requirements: 33.1, 33.2, 33.3, 33.4, 30.4_

- [ ] 82. Security and isolation pass
  - Permission matrix test: every route with every default Role, asserting allow or deny from a table kept beside the catalogue
  - Tenant isolation test over every tenant-scoped model and every list and detail endpoint
  - Property 13 (input safety) on representative text fields of every module
  - Review: every webhook path verifies signatures; rate limits active; no secret or personal data in logs; error responses carry no internals; default Roles hold only needed permissions
  - Confirm that every mandatory test sub-task of R1 exists and passes in CI
  - _Requirements: 20.2, 20.3, 20.4, 20.8, 20.10, 20.11, 20.12, 53.3, 53.4, 53.6, 53.7_

- [ ] 83. Demo data and reset
  - Complete `seed:demo` to the full dataset of Requirement 50.2; `demo:reset` command; `workspace:clear-demo` command
  - _Requirements: 50.2, 50.3, 50.4, 50.5, 50.6_

- [ ] 84. End-to-end workflow tests
  - Automated tests for workflows A, B, C and D of the source specification (A against the fake channel and AI adapters)
  - _Requirements: 53.1, 53.2_

- [ ] 85. Testing-environment operations and guides
  - Database backup and a restore rehearsal on the testing environment, with the date recorded
  - `docs/user-guide.md` (one page per area), `docs/admin-guide.md` (settings, staff, roles, integrations, AI), `docs/known-limitations.md` (everything deferred to R2–R4)
  - Owner-only `/settings/system` page: integration health, queue status, last backup time
  - _Requirements: 22.4, 51.6, 52.5, 52.6_

- [ ] 86. Checkpoint — Release 1 sign-off
  - Walk the client through the acceptance checklist for the areas delivered in R1
  - Record sign-off, open issues and the agreed start of R2
  - Do not begin production deployment or any R2 task without the user's confirmation.

---

## Release 2 — Automation

- [ ] 87. Outbox-backed event bus
  - `OutboxEvent` migration; events written in the business transaction; relay job dispatching to `automation.evaluate`; `DomainEventBus` implementation switched without changing callers
  - _Requirements: 21.5, 55.1_

- [ ] 88. Automation engine
  - `AutomationRule` and `AutomationLog` migration; rules CRUD; `AutomationWorker` evaluating conditions with the shared evaluator and executing `SEND_MESSAGE`, `CREATE_LEAD`, `UPDATE_LEAD`, `CREATE_TASK`, `SEND_NOTIFICATION`, `UPDATE_ORDER_STATUS`
  - Safeguards: platform, workspace and conversation toggles; business hours; consent; approved template outside the free-form window; no rule triggered by automation-caused events; once per entity per trigger per 24 hours
  - Retries up to the rule's maximum; log and Audit_Event for every firing
  - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 42.7_
  - [ ] 88.1 Unit and integration tests: matching rule fires; non-matching does not; global off blocks message sends; a failed action is logged and retried; automation cannot trigger itself
    - _Requirements: 17.1, 17.3, 17.4, 17.6_

- [ ] 89. Scheduled triggers and customer notifications
  - Triggers: no contact for N days, task overdue, payment due in N days, quotation expiring in N days
  - Default rule templates: new lead acknowledgement, follow-up reminder, payment due reminder, order status notification
  - _Requirements: 17.1, 33.7_

- [ ] 90. Notification preferences and email
  - `NotificationPreference` migration and screen; `EmailAdapter` with SMTP driver; emails for invitations, password resets and enabled notification types; remaining notification types of Requirement 33.2
  - _Requirements: 33.2, 33.5, 33.6, 48.3, 45.2_

- [ ] 91. Provider templates and consent
  - Template sync from the provider (`listTemplates`), status display, only approved templates selectable outside the free-form window
  - `ContactConsent` handling: opt-out keywords, opt-in source, blocking of automated and template sends, audit
  - _Requirements: 42.5, 42.6_

- [ ] 92. Facebook Lead Ads adapter
  - Adapter parsing lead-form events and fetching submitted fields; Lead creation with source, channel, campaign, advertisement and form identifiers; field mapping screen
  - _Requirements: 15.4, 42.8, 42.9_

- [ ] 93. Instagram messaging adapter
  - Adapter implementing the `ChannelAdapter` interface for Instagram messages; connection flow on the integrations screen
  - _Requirements: 15.4, 24.1_

- [ ] 94. AI automatic replies, question flow and quotation view tracking
  - `QuestionFlow` editor and `nextQuestion` function
  - `AUTO_REPLY` mode with enabled categories, validator gate, never-send list, `senderType = AI`, human takeover stops it
  - Signed public quotation link recording `viewedAt`
  - _Requirements: 43.3, 43.9, 43.10, 10.3_
  - [ ] 94.1 Integration tests: a flagged draft is never auto-sent; takeover stops auto replies; an opted-out contact receives nothing
    - _Requirements: 43.6, 43.9, 42.6_

- [ ] 95. Automation screens
  - `/automation/rules` list, rule builder (trigger, conditions, action, template), log viewer; AI settings extended with `AUTO_REPLY`, categories and question flows; reports `ai-automation-activity` and `channel-message-volume`
  - _Requirements: 17.5, 44.1_

- [ ] 96. Checkpoint — Release 2
  - A new lead receives the acknowledgement template; a follow-up reminder fires on its date; switching automation off stops both; a Facebook lead form creates an attributed lead
  - Stop and ask the user to review.

---

## Release 3 — Deeper Operations

- [ ] 97. Approvals
  - `ApprovalRequest` service, `GET /approvals`, `POST /approvals/:id/decide`, approvals inbox; approval-required transitions; discount over limit as approval; notifications
  - _Requirements: 27.5, 27.7, 35.4, 33.2_

- [ ] 98. Customer returns, refunds and credit notes
  - Returns API and screens for orders; proportional refund calculation; restock or not; refund by method or to credit; refund receipt PDF; `returnedAmount` and balance recalculation; cancellation with confirmed payments requires refund-or-credit decision; proportional commission reversal
  - _Requirements: 38.1, 38.2, 38.3, 38.4, 38.5, 38.6, 38.7, 38.9, 41.8, 14.6_
  - [ ] 98.1 Property test — Property 7 extended with returns and refunds; integration test that refunds cannot exceed confirmed payments
    - _Requirements: 38.4, 38.6_

- [ ] 99. POS returns
  - `POST /pos/returns` and the returns screen inside a POS session; reverse stock movements; refund receipt
  - _Requirements: 12.8, 38.1, 38.3, 38.5_

- [ ] 100. POS sessions, split payments and daily closing
  - Explicit session open with float; cash in and out; split payments across methods; close with expected, counted and discrepancy; closed session locked; `pos-daily-closing` report and printable closing sheet
  - _Requirements: 12.1, 12.3, 12.7, 12.15, 12.16, 44.3_
  - [ ] 100.1 Integration tests: split payments must cover the total; closing flags a discrepancy; no sale on a closed session
    - _Requirements: 12.3, 12.7_

- [ ] 101. Multiple locations, transfers and stock counts
  - Location selection on orders, POS sessions and purchases; transfers as paired movements; stock count workflow and screens; reports filterable by location
  - _Requirements: 7.6, 37.4, 55.3_

- [ ] 102. Batch, expiry and serial tracking
  - Tracking mode per product; capture on receipts and sales; expiry report; serial lookup
  - _Requirements: 7.7_

- [ ] 103. Stock adjustment approval and supplier returns
  - Approval above the configured threshold; supplier return API and screen; payable reduction
  - _Requirements: 37.3, 38.8_

- [ ] 104. Supplier payments and payables
  - Supplier payments against purchase orders; payables summary; `supplier-balances` report; `account-movements` report
  - _Requirements: 13.2, 13.5, 40.10, 44.1_

- [ ] 105. Production jobs and delivery
  - Production_Job creation on `IN_PRODUCTION`; production workflow; `/production` board for production staff without prices; automatic `READY`; delivery proof upload
  - _Requirements: 39.6, 39.7, 39.8, 39.9_

- [ ] 106. Price lists, tax classes and bundles
  - Price lists with customer assignment and full price resolution order; per-product tax classes; bundle products with component stock deduction
  - _Requirements: 35.1, 35.2, 35.5, 6.8_

- [ ] 107. Advanced commissions
  - Multiple salespeople with shares; order-type and category rules in the rule screen; fixed-per-unit rules; gross-profit base
  - _Requirements: 41.3, 41.4, 41.5, 14.1_

- [ ] 108. Quotation versions, customer merge and pending payment verification
  - Quotation version history; customer merge API and screen with configurable matching rules; `PENDING_VERIFICATION` payments created from a conversation with proof attached
  - _Requirements: 10.6, 8.2, 8.3, 40.6_

- [ ] 109. Data import and list export
  - `BackgroundJobRecord` migration and `GET /jobs/:id`
  - Import flow for products, customers, suppliers and opening stock with mapping, validation preview, background job and templates; CSV export of lists
  - _Requirements: 32.1, 32.2, 32.3, 32.4, 32.5, 32.6, 32.7_

- [ ] 110. Remaining reports, PDF export and thermal text output
  - Reports: `profit-loss`, `stock-valuation`, `top-customers`, `lead-source-performance`, `salesperson-performance`, `returns`, `user-activity`; PDF export of reports; background generation for large ranges
  - ESC/POS plain-text receipt driver behind the Print Output adapter
  - _Requirements: 19.2, 19.6, 21.2, 44.1, 48.5_
  - [ ] 110.1 Reconciliation test extended to every report
    - _Requirements: 19.4, 53.5_

- [ ] 111. Checkpoint — Release 3
  - Return part of a sale and see stock, balance, commission and reports adjust; close a POS session with a discrepancy; transfer stock between locations; import a product file
  - Stop and ask the user to review.

---

## Release 4 — Multi-Industry Platform

- [ ] 112. Field builder
  - `/settings/fields`: create, edit, reorder and deactivate Field_Definitions for every entity type, options editor, visibility condition builder, variant-axis flag
  - _Requirements: 26.1, 26.2, 26.4, 26.6, 26.9_

- [ ] 113. Workflow editor
  - `PUT /workflows/:entityType` and `/settings/workflows`: states, colours, order, System_Role assignment with required-role validation, transitions with permission, required fields and approval flag
  - _Requirements: 27.4, 27.5, 27.8, 11.2_

- [ ] 114. Terminology and document template editors
  - Terminology editor; template editor for each document type (texts, visible columns, bank block, paper size); right-to-left rendering spike and decision recorded (`design.md` D18)
  - _Requirements: 28.1, 28.2, 29.2, 23.4, 49.7_

- [ ] 115. Additional industry profiles
  - Restaurant and electronics profiles as data (fields, workflows, terminology, units, dashboard indicators); smoke test through product, order and POS sale on each
  - _Requirements: 1.5, 44.5, 55.5, 55.6_

- [ ] 116. Onboarding, public signup and platform administration
  - Onboarding wizard; signup controlled by the platform setting; `/platform` screens to list, create, suspend and reactivate workspaces; suspension behaviour; support access grant; `SupportAccessGrant` migration; workspace soft delete and purge
  - _Requirements: 46.1, 46.2, 46.3, 46.4, 46.5, 46.6_

- [ ] 117. Custom report builder
  - `SavedReport`, dataset whitelist, compiler to parameterized queries, builder screen, sharing with roles
  - _Requirements: 19.3, 44.6_

- [ ] 118. Row-level security and security testing
  - RLS policies on every tenant table and the per-request `set_config`; application database role without ownership; IP blocking after repeated violations; external security test and fixes
  - _Requirements: 20.1, 20.5, 20.6, 20.11_

- [ ] 119. Performance and resilience
  - Load test for 100 concurrent users; index and query fixes to meet the latency targets; dashboard caching; circuit-breaker and degraded-mode verification for channel and AI outages
  - _Requirements: 21.1, 21.2, 21.3, 21.4, 31.5_

- [ ] 120. Privacy tools and retention
  - Customer export; anonymization; retention settings and purge job; workspace export
  - _Requirements: 47.1, 47.2, 47.3, 47.4, 47.6_

- [ ] 121. Monitoring and alerts
  - Error tracking hook; metrics; alert definitions; credential rotation procedure
  - _Requirements: 51.3, 51.4, 51.5, 48.11_

- [ ] 122. Production deployment on the client's server
  - `deploy/compose.prod.yml` (web, api, worker, PostgreSQL, Redis, Caddy with TLS); migrations as a release step; daily backups to off-server storage with 14-day retention; restore test; rollback rehearsal; migration failure handling
  - _Requirements: 20.5, 20.7, 22.3, 22.4, 22.5, 52.1, 52.3, 52.4, 52.5, 52.7_

- [ ] 123. Handover package
  - Environment, schema, API, deployment, administrator, user, test report, known limitations and recovery documents; extension-points document
  - _Requirements: 52.6, 55.4, 48.1_

- [ ] 124. Final acceptance
  - Full acceptance checklist signed by the client; payment provider adapter interface reviewed and left switched off
  - _Requirements: 53.9, 48.4_

---

## Task Dependency Graph

Within a release, tasks run in numerical order unless they appear in the same wave, in which case they may run in parallel.

```json
{
  "waves": [
    { "wave": 1,  "release": "R1", "tasks": ["1"] },
    { "wave": 2,  "release": "R1", "tasks": ["2", "3"] },
    { "wave": 3,  "release": "R1", "tasks": ["4", "5"] },
    { "wave": 4,  "release": "R1", "tasks": ["6"] },
    { "wave": 5,  "release": "R1", "tasks": ["7", "8"] },
    { "wave": 6,  "release": "R1", "tasks": ["9"] },
    { "wave": 7,  "release": "R1", "tasks": ["10", "11", "12"] },
    { "wave": 8,  "release": "R1", "tasks": ["13"] },
    { "wave": 9,  "release": "R1", "tasks": ["14", "15"] },
    { "wave": 10, "release": "R1", "tasks": ["16"] },
    { "wave": 11, "release": "R1", "tasks": ["17", "18"] },
    { "wave": 12, "release": "R1", "tasks": ["19"] },
    { "wave": 13, "release": "R1", "tasks": ["20", "21"] },
    { "wave": 14, "release": "R1", "tasks": ["22"] },
    { "wave": 15, "release": "R1", "tasks": ["23"] },
    { "wave": 16, "release": "R1", "tasks": ["24", "25"] },
    { "wave": 17, "release": "R1", "tasks": ["26", "27"] },
    { "wave": 18, "release": "R1", "tasks": ["28", "29"] },
    { "wave": 19, "release": "R1", "tasks": ["30"] },
    { "wave": 20, "release": "R1", "tasks": ["31", "32", "33"] },
    { "wave": 21, "release": "R1", "tasks": ["34"] },
    { "wave": 22, "release": "R1", "tasks": ["35", "36"] },
    { "wave": 23, "release": "R1", "tasks": ["37"] },
    { "wave": 24, "release": "R1", "tasks": ["38"] },
    { "wave": 25, "release": "R1", "tasks": ["39"] },
    { "wave": 26, "release": "R1", "tasks": ["40", "41"] },
    { "wave": 27, "release": "R1", "tasks": ["42", "43"] },
    { "wave": 28, "release": "R1", "tasks": ["44"] },
    { "wave": 29, "release": "R1", "tasks": ["45"] },
    { "wave": 30, "release": "R1", "tasks": ["46"] },
    { "wave": 31, "release": "R1", "tasks": ["47", "48"] },
    { "wave": 32, "release": "R1", "tasks": ["49"] },
    { "wave": 33, "release": "R1", "tasks": ["50"] },
    { "wave": 34, "release": "R1", "tasks": ["51", "52"] },
    { "wave": 35, "release": "R1", "tasks": ["53"] },
    { "wave": 36, "release": "R1", "tasks": ["54"] },
    { "wave": 37, "release": "R1", "tasks": ["55"] },
    { "wave": 38, "release": "R1", "tasks": ["56"] },
    { "wave": 39, "release": "R1", "tasks": ["57"] },
    { "wave": 40, "release": "R1", "tasks": ["58"] },
    { "wave": 41, "release": "R1", "tasks": ["59"] },
    { "wave": 42, "release": "R1", "tasks": ["60"] },
    { "wave": 43, "release": "R1", "tasks": ["61"] },
    { "wave": 44, "release": "R1", "tasks": ["62"] },
    { "wave": 45, "release": "R1", "tasks": ["63", "64"] },
    { "wave": 46, "release": "R1", "tasks": ["65", "66"] },
    { "wave": 47, "release": "R1", "tasks": ["67"] },
    { "wave": 48, "release": "R1", "tasks": ["68", "69"] },
    { "wave": 49, "release": "R1", "tasks": ["70", "71"] },
    { "wave": 50, "release": "R1", "tasks": ["72"] },
    { "wave": 51, "release": "R1", "tasks": ["73"] },
    { "wave": 52, "release": "R1", "tasks": ["74"] },
    { "wave": 53, "release": "R1", "tasks": ["75"] },
    { "wave": 54, "release": "R1", "tasks": ["76"] },
    { "wave": 55, "release": "R1", "tasks": ["77"] },
    { "wave": 56, "release": "R1", "tasks": ["78", "79"] },
    { "wave": 57, "release": "R1", "tasks": ["80"] },
    { "wave": 58, "release": "R1", "tasks": ["81", "82", "83"] },
    { "wave": 59, "release": "R1", "tasks": ["84", "85"] },
    { "wave": 60, "release": "R1", "tasks": ["86"] },
    { "wave": 61, "release": "R2", "tasks": ["87"] },
    { "wave": 62, "release": "R2", "tasks": ["88", "90", "91"] },
    { "wave": 63, "release": "R2", "tasks": ["89", "92", "93"] },
    { "wave": 64, "release": "R2", "tasks": ["94"] },
    { "wave": 65, "release": "R2", "tasks": ["95"] },
    { "wave": 66, "release": "R2", "tasks": ["96"] },
    { "wave": 67, "release": "R3", "tasks": ["97"] },
    { "wave": 68, "release": "R3", "tasks": ["98", "100", "101", "104", "106", "109"] },
    { "wave": 69, "release": "R3", "tasks": ["99", "102", "103", "105", "107", "108"] },
    { "wave": 70, "release": "R3", "tasks": ["110"] },
    { "wave": 71, "release": "R3", "tasks": ["111"] },
    { "wave": 72, "release": "R4", "tasks": ["112", "113", "114"] },
    { "wave": 73, "release": "R4", "tasks": ["115", "116", "117", "120"] },
    { "wave": 74, "release": "R4", "tasks": ["118", "119", "121"] },
    { "wave": 75, "release": "R4", "tasks": ["122"] },
    { "wave": 76, "release": "R4", "tasks": ["123"] },
    { "wave": 77, "release": "R4", "tasks": ["124"] }
  ]
}
```
