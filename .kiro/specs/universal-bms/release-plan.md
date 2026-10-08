# Release Plan

This file maps `tasks.md` to delivery dates. It is the only place where days are assigned. If a date here and a task disagree, the task's scope wins and this file is corrected.

## Release 1 — 15 working days

| Day | Phase | Tasks | Result on the testing environment |
|---|---|---|---|
| 1 | 0 Setup, 1 Foundation | 1–16 | Login, business profile, staff accounts, roles and permissions, audit log, settings; deployed |
| 2 | 2 Products | 17–22 | Catalog, categories, brands, variants, furniture attributes, images |
| 3 | 3 Customers and leads | 23–30 | Customers, lead pipeline, tasks, notes, timeline, global search |
| 4 | 4 Quotations and orders | 31–38 | Quotations, custom lines, orders with status flow, PDFs for quotation, confirmation and invoice |
| 5 | 5 Payments and finance | 39–44 | Deposits, balances, payment methods, accounts, expenses, receivables, bank details on documents |
| 6 | 6 Inventory | 45–49 | Stock ledger, opening stock, adjustments with reasons, reservations, low-stock flags |
| 7 | 7 Point of sale | 50–54 | Checkout, discounts, stock deduction, receipt PDF in 58mm, 80mm and A4, reprint |
| 8 | 8 Purchasing | 55–58 | Suppliers, purchase orders, receiving, quick purchase |
| 9 | 9 Commissions and activity | 59–62 | Commission per staff member, statement, approval and payment, activity log on records |
| 10 | 10 Dashboard and reports | 63–67 | Dashboard, 16 reports with drill-down and CSV export. **Core system checkpoint** |
| 11–12 | 11 Messaging | 68–75 | WhatsApp inbox, replies, templates, quick replies, attachments, delivery status |
| 13 | 12 AI assistant | 76–80 | Summaries, requirement extraction, product matching, draft replies, staff approval |
| 14–15 | 13 Hardening and acceptance | 81–86 | Notifications, permission and isolation test passes, demo data, end-to-end tests, guides, sign-off |

### Load per day

Day 1 carries 16 tasks and is the heaviest day in the plan. Tasks 12 (file storage) and 14 (settings and staff screens) are the ones that can slide into the morning of day 2 without blocking anything, because day 2 needs file upload only for product images and has six tasks. No other day has slack. A blocked day moves every later day.

### What Release 1 leaves to later releases

| Area | In R1 | Later |
|---|---|---|
| Configuration | Furniture profile; fields and workflows stored as data and changeable through the API | Field builder, workflow editor, terminology and template editors (R4) |
| Quotations | Create, send, accept, convert, expire | Version history (R3), view tracking (R2) |
| Orders | Full status flow, custom lines, deposit rule, fulfilment fields | Production jobs and production board (R3), approvals (R3) |
| Payments | Record, confirm, void, credit, receivables | Refunds and returns (R3), supplier payments and payables (R3), verification of customer-claimed payments from chat (R3) |
| Inventory | One location, opening stock, adjustments, reservations, average cost | Transfers, stock counts, batch and serial, adjustment approval (R3) |
| POS | One payment method per sale, automatic daily session, receipts, reprint | Split payments, session float and closing, cash in and out, returns (R3) |
| Purchasing | Suppliers, purchase orders, partial and full receiving | Supplier payments and returns (R3) |
| Commissions | Percentage per staff member, statement, approve, pay, reversal on cancel | Splits, category and order-type rules, profit base, partial reversal (R3) |
| Reports | 16 reports, CSV export | Profit and loss, stock valuation and the remaining reports, PDF export (R3); report builder (R4) |
| Messaging | WhatsApp inbox with manual replies | Provider template sync, consent handling, Facebook Lead Ads, Instagram (R2) |
| AI | `ASSIST` mode: staff approve every suggestion and reply | `AUTO_REPLY`, question flows (R2) |
| Automation | None; follow-ups and low stock appear on screen and as in-app notifications | Rules engine, reminders and customer notifications (R2) |
| Platform | One workspace created by command; tenant scoping enforced from day 1 | Signup, onboarding, platform admin, row-level security (R4) |
| Deployment | Testing environment | Production on the client's server after sign-off (R4, task 122; can be brought forward) |

## Later Releases

| Release | Tasks | Estimate (working days) | Depends on |
|---|---|---|---|
| R2 Automation | 87–96 | about 15 | R1 sign-off; Meta template approval; Facebook and Instagram app permissions |
| R3 Deeper operations | 97–111 | about 32 | R1 sign-off |
| R4 Multi-industry platform | 112–124 | about 25 | R3; client's server and domain for task 122 |

Estimates are planning figures for one developer working with an AI coding agent. Confirm each before the release starts.

## What Must Exist Before Each Phase

Provided by the developer:

| Needed | By | For |
|---|---|---|
| Testing environment: web service, API service, PostgreSQL | Day 1 | Task 15 |
| S3-compatible storage bucket and keys | Day 1 | Task 12 (product images from day 2) |
| RS256 key pair, integration encryption key | Day 1 | Tasks 8, 70 |
| Key-value store (Redis-compatible) on the testing environment | Day 11 | Task 68 |
| A Meta developer app (app secret, webhook verify token) with the WhatsApp product added | Day 10 | Tasks 71, 72 |

Provided by the client:

| Needed | By | For |
|---|---|---|
| Meta Business account, verification completed or submitted, developer added as admin | Day 10 (start day 1) | Tasks 71–75 |
| A phone number not active on the WhatsApp or WhatsApp Business app; payment method on the Meta account | Day 10 | Tasks 71–75 |
| AI provider API key with billing enabled | Day 12 | Tasks 76–80 |
| One contact person to test each day's work and sign off on day 15 | Every day | Checkpoints |
| Server and domain with DNS access | After R1 sign-off | Task 122 |

If the Meta account is not approved by day 10, tasks 71–75 are built and demonstrated on Meta's test phone number and the connection is switched to the client's number when approval arrives.
