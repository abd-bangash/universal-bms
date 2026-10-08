# Traceability: Source Specification → Requirements → Tasks

Source: *Universal Business Management & AI Automation System — Developer Requirements & Functional Specification*, version 1.0, sections 1–28. Every section maps to at least one requirement and one task. Use this file to check that nothing in the client's document has been left without a home.

## By Section

| § | Source section | Requirements | Tasks |
|---|---|---|---|
| 1 | Document purpose and scope | all | all |
| 2 | Product vision | 1, 55 | 9, 115 |
| 3 | Core operating model (core, industry, configuration, automation, AI layers; owner, status, timestamps and audit on every record) | 1, 4, 5, 17, 18, 26, 27 | 6, 7, 9, 11, 18, 25 |
| 4 | Industry-independent configuration engine | 1.5, 1.6, 5, 6.3–6.5, 26, 27, 28, 29 | 9, 11, 18, 25, 112, 113, 114, 115 |
| 5 | Customer, CRM and lead management | 8, 9, 30, 31, 32 | 23–30, 108, 109 |
| 6 | Business messaging and social lead integration | 15, 16, 42 | 68–75, 91, 92, 93 |
| 7 | AI assistant and automation engine | 17, 18, 43 | 76–80, 88, 89, 94 |
| 8 | Product, catalog and attribute management | 6, 35, 36 | 17–21, 106 |
| 9 | Inventory, purchasing and supplier management | 7, 28.4–28.6, 37, 38.8 | 45–49, 55–58, 101–104 |
| 10 | Sales orders, quotations and custom work | 10, 11, 39 | 31–38, 105, 108 |
| 11 | POS, sales and receipt management | 12, 23, 29.8, 56 | 50–54, 99, 100, 110 |
| 12 | Industry-specific capability examples | 1.5, 55.5, 55.6 | 9, 115 |
| 13 | Payments, bank accounts, expenses and financial tracking | 13, 38, 40 | 39–44, 98, 104, 108 |
| 14 | Staff, salesperson and commission management | 14, 41 | 10, 59–62, 107 |
| 15 | Dashboard, reports and business intelligence | 19, 44 | 63–66, 95, 100, 104, 110, 117 |
| 16 | Users, roles, permissions and audit | 2, 3, 4, 45 | 6, 7, 8, 10, 14, 61, 82 |
| 17 | Notifications, templates and workflow automation | 16.3, 16.4, 17, 29, 33 | 73, 81, 88, 89, 90, 91 |
| 18 | Integration and API requirements | 24, 48 | 12, 70, 71, 76, 90, 109, 121 |
| 19 | Core data model guidance | design.md "Data Models" | 6, 17, 23, 31, 39, 45, 50, 55, 59, 69 |
| 20 | Security, privacy and reliability | 20, 21, 34, 45, 47, 54 | 3, 4, 8, 12, 82, 118, 119, 120 |
| 21 | User experience and application structure | 49 | 13 and every screen task |
| 22 | Step-by-step development plan | tasks.md phases | release-plan.md |
| 23 | Critical end-to-end workflows A–D | 53.2 | 38, 44, 54, 67, 75, 80, 84 |
| 24 | QA and acceptance criteria | 53 | all test sub-tasks, 82, 84, 119, 124 |
| 25 | Deployment, monitoring and handover | 22, 51, 52 | 2, 15, 85, 121, 122, 123 |
| 26 | Extensibility and future modules | 55 | 123; design.md "Extension Points" |
| 27 | Non-negotiable development principles | see below | see below |
| 28 | Final developer deliverable definition | 1–56 | 86, 124 |

## Non-Negotiable Principles (§27)

| # | Principle | Where it is enforced |
|---|---|---|
| 1 | Do not hard-code one industry | Req 1.5, 26, 27, 28; design D5, D6; task 115 proves it with two more profiles |
| 2 | Do not duplicate modules by industry | Req 55.1; one module per domain in design.md |
| 3 | Keep external integrations behind adapters | Req 24, 48; `ChannelAdapter`, `AIAdapter`, `StorageAdapter`, `EmailAdapter`, Print Output and Payment Provider interfaces |
| 4 | Use configuration before custom code | Req 5, 26, 27; `FieldDefinition`, `Workflow`, `WorkspaceConfig`, `IndustryProfile` |
| 5 | Maintain complete auditability | Req 4; Properties 3 and 4; task 7 |
| 6 | Protect tenant boundaries | Req 1.3, 1.4, 20.1; Property 1; tasks 4, 82, 118 |
| 7 | Make AI controllable | Req 16.5–16.7, 18.5, 18.6, 43.9, 43.10; Property 20 |
| 8 | Never treat AI output as unquestioned truth | Req 18.4, 18.10, 40.6, 43.5, 43.6; Property 19 |
| 9 | Design for failure | Req 21.3, 43.14, 48.7, 48.8, 56; `AdapterRunner`; task 119 |
| 10 | Build reusable components | Req 49.11, 55; shared `packages/calc`, `DynamicFields`, generic report page |

## Items in the Source That the Earlier Draft Did Not Cover

Each of these was named in the client's document and had no requirement, design or task in the first version of these files. All now do.

| Source | Item | Now covered by |
|---|---|---|
| §4 | Custom fields on entities other than products | Req 26; tasks 18, 112 |
| §4 | Conditional fields | Req 26.4, 26.5; task 18 |
| §4 | Configurable purchase, production and payment statuses | Req 27.1, 27.9; tasks 25, 113 |
| §4 | Configurable workflows with required steps and approvals | Req 27.5–27.8; tasks 25, 97, 113 |
| §4 | Terminology | Req 28.1–28.3; tasks 11, 13, 114 |
| §4, §9 | Units and unit conversion | Req 28.4–28.7; tasks 11, 46 |
| §4 | Template-driven documents including invoices and order confirmations | Req 29; tasks 36, 114 |
| §5 | Tasks, calls, reminders, meetings, internal notes | Req 30; task 27 |
| §5 | Global search | Req 31; task 29 |
| §5 | Customers entering by import | Req 32; task 109 |
| §5 | Lead fields: campaign, interest, estimated value, priority, next action | Req 9.2; task 26 |
| §6 | Provider rules and customer consent | Req 42.4–42.6; tasks 73, 91 |
| §6 | Delivery status, media types, out-of-order events | Req 42.1–42.3; task 72 |
| §6 | Automation off per conversation and by rule | Req 42.7; task 88 |
| §6 | Sending bank details by approved template; sending documents as attachments | Req 40.11, 42.10; tasks 42, 73 |
| §6 | Instagram and social lead normalization with attribution | Req 15.4, 42.8, 42.9; tasks 92, 93 |
| §7 | Product matching, missing-question flow, next-action suggestion, internal notes | Req 43.1–43.4; tasks 77, 94 |
| §7 | Never invent prices, availability, payments or policies | Req 43.5, 43.6; Property 19; task 77 |
| §7 | Approved knowledge sources, tone and length settings | Req 43.7, 43.8; tasks 77, 78 |
| §8 | Brand, unit, barcode, minimum and maximum stock | Req 36.1–36.3; tasks 17, 19 |
| §8 | Price lists and customer-specific pricing | Req 35.1, 35.2; task 106 |
| §8 | Product-to-message mapping; visibility per channel | Req 36.4, 36.5; task 19 |
| §9 | Opening stock; adjustments with reasons | Req 37.1, 37.2; task 46 |
| §9 | Stock valuation method | Req 37.7, 37.8; tasks 46, 110 |
| §9 | Customer returns and supplier returns | Req 38; tasks 98, 99, 103 |
| §10 | Customer approval, quality check, order closing, attachments, fulfilment details | Req 39; tasks 34, 35, 105 |
| §11 | Barcode entry, walk-in customer, receipt reprint, daily closing, salesperson attribution | Req 12.10–12.16; tasks 51, 53, 100 |
| §11 | Offline-safe behaviour (considered) | Req 56.1 states it is excluded in this version |
| §13 | Bank and cash accounts, configurable payment methods | Req 40.1–40.4; tasks 39, 40 |
| §13 | A payment is not received because a customer says so | Req 40.5, 40.6; tasks 40, 108 |
| §13 | Refunds; audit of edits, cancellations and reversals | Req 13.10, 38, 40.7; tasks 40, 98 |
| §14 | Staff profiles; rules by salesperson and order type; configurable commission base; attribution across several staff; performance dashboard | Req 41; tasks 10, 60, 61, 107 |
| §15 | Lead source performance, purchases, expenses, supplier balances, AI and channel activity | Req 44.1; tasks 63, 95, 104, 110 |
| §16 | Account Staff, Production Staff and AI/Automation Operator roles | Req 2.8; task 9 |
| §16 | Login and security events in the audit trail | Req 45.8; task 8 |
| §17 | Internal notifications and per-user preferences | Req 33; tasks 81, 90 |
| §18 | Email, payment, storage and print adapters; import and export | Req 48, 34, 32; tasks 12, 90, 109, 110 |
| §18 | Per-integration contract: rate limits, timeouts, error mapping, monitoring, reconnect, resync | Req 48.1, 48.7–48.11; task 70 |
| §19 | Workflow, WorkflowState, Template, Invoice entities | design.md models `Workflow`, `WorkflowState`, `MessageTemplate`, `Invoice` |
| §20 | File type and size validation; unauthorized file access | Req 34.2–34.4; task 12 |
| §20 | Data retention, deletion and export procedures | Req 47; task 120 |
| §20 | Documented AI data handling | Req 43.12, 47.5; task 79 |
| §21 | The 13 application areas and their screens | Req 49.1; task 13 and screen tasks |
| §24 | Named test types and the acceptance table | Req 53; tasks 82, 84, 119, 124 |
| §25 | Monitoring, alerting, rollback, credential rotation, handover package | Req 51, 52, 48.11; tasks 85, 121, 122, 123 |
| §26 | Future modules and extension points | Req 55.4; design.md "Extension Points" |
