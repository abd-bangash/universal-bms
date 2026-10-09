# Release 1 — acceptance checklist and sign-off record

Status: **built and verified automatically; waiting for the client walkthrough and signature.**
Nothing in Release 2 or in production deployment has been started.

## 1. Automated evidence (run on 2026-10-09, branch `claude/cool-turing-201248`)

`pnpm lint && pnpm typecheck && pnpm test` — all green: 9/9 lint and type-check tasks; calculation
package 80 tests; web 394 tests; API 1,054 tests (end-to-end against a real PostgreSQL, Redis for the
queue tests).

| Requirement 53 item                                    | Where                                                                                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Workflows A–D end to end                               | `apps/api/test/end-to-end.e2e-spec.ts` (A against the fake WhatsApp and AI adapters), plus the day-10, messaging and AI checkpoints |
| Every endpoint × every default role                    | `test/permissions.e2e-spec.ts`, `test/role-matrix.e2e-spec.ts`                                                                      |
| Tenant isolation, every model and list/detail endpoint | `test/tenant-isolation*.e2e-spec.ts`, `test/tenant-isolation-api.e2e-spec.ts`                                                       |
| Reports equal their source records                     | `test/reports.e2e-spec.ts`, `core-checkpoint.e2e-spec.ts`, `end-to-end.e2e-spec.ts`                                                 |
| Correctness properties (≥ 100 cases each)              | `*-properties*`, `input-safety`, calc package; counted by `test/spec-coverage.spec.ts`                                              |
| AI extraction quality                                  | `test/ai-eval/` (replayed in CI; live mode on demand)                                                                               |
| Security review                                        | `docs/security-review.md`                                                                                                           |

## 2. Acceptance checklist for the client walkthrough

Tick each line during the walkthrough on the testing environment (use the demo business, then a clean one).

| #   | Area               | Walk through                                                                                                   | Pass |
| --- | ------------------ | -------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Sign-in, roles     | Sign in as Owner and Cashier; the Cashier cannot see reports, staff or settings                                | ☐    |
| 2   | Settings           | Business details and document numbers show on a printed quotation                                              | ☐    |
| 3   | Products           | Add a product with two variants and an image                                                                   | ☐    |
| 4   | Customers, leads   | Add a lead, move it through the board, add a task and a note                                                   | ☐    |
| 5   | Quotation          | Custom sofa with measurements, send, accept, convert to an order                                               | ☐    |
| 6   | Order and payments | Production is refused before the deposit; record the deposit, void a wrong balance, take the balance, complete | ☐    |
| 7   | Documents          | Quotation, order confirmation, invoice and receipt PDFs look right                                             | ☐    |
| 8   | Inventory          | Opening stock, an adjustment with a reason, a reservation, a low-stock flag                                    | ☐    |
| 9   | Point of sale      | Walk-in sale, 80 mm and A4 receipt, reprint, sale beyond stock refused                                         | ☐    |
| 10  | Purchasing         | Purchase order, partial receive, stock and cost update                                                         | ☐    |
| 11  | Commissions        | A completed order earns the salesperson a commission; approve and pay                                          | ☐    |
| 12  | Reports            | Sales by date matches the orders; export to CSV                                                                | ☐    |
| 13  | WhatsApp           | A message from a phone becomes a lead and a conversation; reply; ticks update                                  | ☐    |
| 14  | AI                 | The assistant reads a customer's request; staff approve details and a reply                                    | ☐    |
| 15  | Notifications      | The bell shows a new conversation and a due task                                                               | ☐    |
| 16  | System status      | Owner sees services, integrations, queues and the last backup time                                             | ☐    |
| 17  | Backup             | A backup is taken and the restore rehearsal passes (`docs/admin-guide.md` §7)                                  | ☐    |
| 18  | Guides             | The client can find their way with `docs/user-guide.md` and `docs/admin-guide.md`                              | ☐    |

## 3. Open issues and limits going into sign-off

1. **Hosted-environment checks not yet done.** The build session had no access to the testing
   environment, so these remain to be done there: deploy and `GET /health/ready`; the backup and restore
   rehearsal (rehearsed 2026-10-09 on the development PostgreSQL only); a real WhatsApp test number
   through Meta; a real Anthropic key. Until then the WhatsApp and AI paths are proven against fakes.
2. **Rollback procedure** (Requirement 52.4) not yet rehearsed; due before production go-live.
3. **Optional Playwright smoke test** (sub-task 13.1) was not built.
4. **Load tests** (Requirement 53.1) were not run; schedule before production.
5. **No screen yet for** the WhatsApp opt-out keywords setting (settings API only).
6. Everything in `docs/known-limitations.md` is deferred by design to R2–R4.

## 4. Sign-off

|                                                                   |     |
| ----------------------------------------------------------------- | --- |
| Client representative                                             |     |
| Date of walkthrough                                               |     |
| Environment and version walked through                            |     |
| Result (accepted / accepted with the issues above / not accepted) |     |
| Signature                                                         |     |

## 5. Next steps (to be agreed with the client — not started)

- Release 2 (Automation, tasks 87–96) needs Meta template approval and Facebook/Instagram permissions;
  proposed start date: **to be agreed**.
- Production deployment (Release 4, task 122) happens only after the client signs off testing on the
  testing environment (Requirement 52.7).
