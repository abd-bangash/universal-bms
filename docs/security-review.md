# Security and isolation review (Release 1)

Done in task 82. Each point names the test that keeps it true; run them with `pnpm test`.

| Point | Result | Where it is checked |
| --- | --- | --- |
| Every tenant-scoped model hides its rows from other workspaces | Holds | `test/tenant-isolation.e2e-spec.ts` (Property 1) |
| Every list endpoint returns none of another workspace's ids; every route that takes an id refuses another workspace's record (404) for every method; nothing in the other workspace changes; search is scoped | Holds | `test/tenant-isolation-api.e2e-spec.ts`. A route with an id that is not in the test's table fails it, so new endpoints cannot slip past |
| Every route names a permission, is public, or needs only a session; the public and session-only lists are exactly the reviewed lists | Holds | `test/permissions.e2e-spec.ts` |
| Each default Role is allowed a route exactly when it holds the route's permission (every route × every Role, with real sign-ins), and no allowed route answers 500 to an empty request | Holds, after one fix (below) | `test/role-matrix.e2e-spec.ts` |
| Default Roles hold only what their work needs; a table of what each must **not** hold | Holds, after one change (below) | `test/role-matrix.e2e-spec.ts`, `packages/types/src/roles.ts` |
| Quotes, comment markers, SQL keywords and the like in any text field are data: accepted, stored as typed, no other row changes; `%` and `_` in a search are not wildcards | Holds, after one fix (below) | `test/input-safety.e2e-spec.ts` (Property 13) |
| Every webhook verifies its signature; an unsigned or wrongly signed delivery is refused and audited | Holds | `test/webhooks.e2e-spec.ts`, `test/security-review.e2e-spec.ts` |
| Rate limits: 10 sign-in attempts a minute per address, 600 webhooks a minute per provider, 300 requests a minute per person | Holds, after two fixes (below) | `test/security-review.e2e-spec.ts` |
| No password, token, key, e-mail, phone number, address or message text in the logs | Holds | `test/security-review.e2e-spec.ts` (captures the log of a run that handles all of these, including failures) |
| Error responses carry no stack trace, query text, path, secret or provider text | Holds, after one fix (below) | `test/security-review.e2e-spec.ts` |
| Security headers on every response (CSP, HSTS, nosniff, referrer policy, no `X-Powered-By`) | Holds | `test/security-review.e2e-spec.ts` |
| No response carries a password hash, a stored secret or a token it was not asked for | Holds | `test/security-review.e2e-spec.ts` |
| Every non-optional test sub-task of Release 1 that belongs to a finished task is finished; every correctness property named in the task list has a test that names it; CI runs lint, type check and the whole suite against PostgreSQL and Redis | Holds | `apps/api/test/spec-coverage.spec.ts`, `.github/workflows/ci.yml` |

## What the review found and fixed

1. **A required field was optional.** `CreateRuleDto` (commission rules) inherited `@IsOptional()` from a parent class, so an empty request got past validation and ended in a 500. The required fields are now declared on the create DTO itself. The role matrix would catch the same mistake anywhere else.
2. **A NUL character in text caused a 500.** PostgreSQL cannot store it. The validation pipe now refuses it as a 400 with the field named, and a provider's webhook text has it removed on receipt.
3. **An oversized request body was answered 500.** Client errors raised by the body parser (too large, malformed) are now answered with their own 4xx.
4. **Rate limits were counted per route, and per address even for signed-in people.** The library default counted each route separately (so 300 a minute to *every* endpoint), and the user resolver was not visible to the throttle guard, so people sharing an address (an office, a proxy) shared one allowance while one person could spread requests across addresses. The count is now one per limit and tracker (person or address), shared by all routes, and the auth module exports the resolver.
5. **The read-only Viewer role could read the audit trail and the state of outside connections.** Both are now excluded from the Viewer role (Requirement 20.11).

## Not done in Release 1

- Blocking an address after repeated violations (Requirement 20.6, Release 4); violations are audited.
- Encryption at rest and TLS are the hosting platform's (Requirement 20.5); see `docs/deployment-testing.md`.
- The database account's rights (Requirement 20.11, second part) are set where the database is provisioned; the application uses one role with the rights it needs and no superuser.
