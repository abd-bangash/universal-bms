# Structure

```
apps/web        Next.js App Router. Pages under app/(auth) and app/(app); BFF at app/api/bff/[...path]
apps/api        NestJS. src/common (guards, prisma, context, events, money), src/modules/<domain>, src/jobs, prisma/, test/
packages/types       Entity types, API contracts, permissions, adapter interfaces, event payloads
packages/validators  Zod schemas: workspace config, custom fields, visibility conditions, web forms
packages/calc        Pure functions: pricing, tax, rounding, commission, field validation and visibility
packages/config      Shared ESLint, TypeScript and Prettier config
docs/           Guides, deployment, AI data handling
deploy/         render.yaml (testing), compose.prod.yml and Caddyfile (production)
.kiro/          steering/ and specs/universal-bms/
```

## API Module Layout

```
modules/<domain>/
  <domain>.module.ts
  <domain>.controller.ts        thin: decorators, DTO in, service call, DTO out
  <domain>.service.ts           business logic, transactions, audit, events
  dto/                          class-validator request DTOs and response mappers
  __tests__/                    unit and property tests
```

Integration tests live in `apps/api/test/<domain>.e2e-spec.ts`.

Modules: `auth`, `tenants`, `users`, `settings`, `fields`, `workflows`, `audit`, `files`, `catalog`, `inventory`, `purchasing`, `crm`, `tasks`, `search`, `orders`, `production`, `documents`, `pos`, `payments`, `commissions`, `channels`, `integrations`, `ai`, `automation`, `notifications`, `reporting`, `imports`, `platform`, `health`.

## Web Layout

- One folder per area under `app/(app)/`; URLs are listed in `design.md`.
- Shared building blocks in `components/`: `data-table`, `forms`, `dynamic-fields`, `layout`, `ui`.
- `lib/navigation.ts` is the single registry of navigation entries with their permission and module.
- A list page is `page.tsx` using `DataTable`; a record page is `[id]/page.tsx`; forms use `FormShell`.

## Naming

- Database: snake_case tables and columns through `@@map` / `@map`. Prisma models PascalCase, fields camelCase.
- Files: kebab-case. Classes PascalCase. Permission strings `resource:action`. Event names `entity.verb_past`.
- Queue names `area.action`. Report keys kebab-case.
- Error codes UPPER_SNAKE_CASE.
