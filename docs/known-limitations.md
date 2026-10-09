# Known limitations (Release 1)

Everything below is deliberately **not** in Release 1. Release 1 is for the testing environment; the
later releases are planned in `.kiro/specs/universal-bms/release-plan.md`.

## Deferred to later releases

| Area          | Works in Release 1                                                                                 | Not yet (release)                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Configuration | Furniture profile; fields, workflows and terminology stored as data and changeable through the API | Field builder, workflow editor, terminology and template editors (R4)                                             |
| Quotations    | Create, send, accept, convert, expire                                                              | Version history (R3), view tracking (R2)                                                                          |
| Orders        | Full status flow, custom lines, deposit rule, fulfilment fields                                    | Production jobs and board (R3), approvals (R3)                                                                    |
| Payments      | Record, confirm, void, customer credit, receivables                                                | Refunds and returns (R3), supplier payments and payables (R3), verifying a payment a customer claims in chat (R3) |
| Inventory     | One location, opening stock, adjustments, reservations, average cost                               | Transfers, stock counts, batch and serial numbers, adjustment approval (R3)                                       |
| Point of sale | One payment method per sale, automatic daily session, receipts (58 mm, 80 mm, A4), reprint         | Split payments, explicit session open and close with float, cash in and out, returns (R3)                         |
| Purchasing    | Suppliers, purchase orders, partial and full receiving                                             | Supplier payments and purchase returns (R3)                                                                       |
| Commissions   | Percentage per staff member, statement, approve, pay, reversal on cancel                           | Splits, rules by category or order type, profit base, partial reversal (R3)                                       |
| Reports       | 16 reports with CSV export                                                                         | Profit and loss, stock valuation and the remaining reports, PDF export (R3); report builder (R4)                  |
| Messaging     | WhatsApp inbox, replies, templates, quick replies, attachments, delivery ticks                     | Provider template sync, consent handling, Facebook Lead Ads, Instagram (R2)                                       |
| AI            | Assist mode with Anthropic: staff approve every suggestion and every reply                         | Automatic replies and question flows (R2); other AI providers                                                     |
| Automation    | Follow-ups and low stock show on screen and as in-app notifications                                | Rules engine, reminders and customer notifications (R2)                                                           |
| Platform      | One business per installation, created by command; tenant scoping enforced                         | Sign-up, onboarding, platform admin, database row-level security (R4)                                             |
| Deployment    | The testing environment                                                                            | Production on the client's server after sign-off (R4)                                                             |

## Behaviours to know about

- **Reports.** Stock-on-hand and low-stock reports show the position now, not at a past date. Exports
  stop at 5,000 rows (the screen says so); narrow the dates for more.
- **Home dashboard.** Open to every signed-in person; each indicator appears only if the person may see
  it (money figures need financial permission).
- **Commissions.** A fixed amount per order is attached to the first line that selects it. A commission
  already paid is not clawed back when an order is cancelled; it is shown as owed back.
- **Payments.** An overpayment and applying customer credit both need the _confirm payment_ permission.
  Cancelling a paid order keeps the money as customer credit; refunds come in R3. Advance payments have
  no order and get a receipt only.
- **Receiving purchases** posts stock directly; it does not wait for approval.
- **Documents.** The order confirmation PDF is generated when asked for, so it always reflects the
  current order; quotations and invoices are fixed snapshots. Invoices cannot be edited or deleted.
- **WhatsApp.** Free-form messages only inside the 24-hour window after the customer's last message;
  outside it a provider-approved template is needed (template sync is R2). A customer who writes a stop
  word (the `messaging.optOutKeywords` business setting, changed through the settings API; there is no
  screen for it yet) is not messaged again.
- **Webhook retries** back off 30 s, 60 s, 120 s (four tries), then the event is marked failed and
  appears in the system status page's job counts.
- **AI.** Extracted details go onto the lead, so a conversation needs a lead first. A size approved from
  AI is saved as a custom size. Prompts, the data sent to the provider and the daily limits are
  described in `docs/ai-data-handling.md`.
- **Rate limits** are per signed-in person (per address when signed out).
- **Viewer role** cannot see the audit log or the integrations page.
- **Browser tests.** The optional Playwright smoke test (sub-task 13.1) was not built; screens are
  covered by component tests and the API by end-to-end tests.

## Operations record

| What                                  | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backup and restore rehearsal          | **2026-10-09.** `scripts/backup.sh` dumped a database holding the full demo dataset (368 KB); `scripts/restore-test.sh` restored it into a scratch database and found 1 workspace, 9 users, 17 orders, 330 audit events and all 13 migrations. The rehearsal ran on the development container's PostgreSQL 16, because the hosted testing environment was not reachable from the build session. **Repeat it on the testing environment (steps in `docs/admin-guide.md`, "Backups") and record the new date here before the client's acceptance test.** |
| Rollback rehearsal (Requirement 52.4) | Not yet done; due before production go-live (R4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
