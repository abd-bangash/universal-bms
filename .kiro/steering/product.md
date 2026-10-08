# Product

**Universal Business Management & AI Automation System (Universal BMS)** — one configurable, multi-tenant web application in which a small or medium business runs customers, leads, conversations, products, inventory, purchases, quotations, orders, point of sale, payments, expenses, commissions and reports, with an optional AI assistant on its messaging channels.

The first customer is a **furniture business** (custom sizes, materials, colours, designs, deposits, production, delivery). The product must serve restaurants, electronics, pharmacy, retail and others later **through configuration only**.

## Rules That Override Everything Else

1. Never hard-code furniture. Industry behaviour comes from `IndustryProfile`, `FieldDefinition`, `Workflow` and terminology.
2. Never duplicate a module for an industry.
3. Every external service sits behind an adapter interface.
4. Prefer configuration to code.
5. Every change to money, stock, permissions, orders and automation is audited.
6. No data ever crosses a workspace boundary. A leak is a critical defect.
7. The business can always switch AI and automation off and take over a conversation.
8. AI output is a suggestion. Prices, stock, payments and commitments come from the database or a human.
9. External services fail. The core must keep working when they do.
10. Build reusable components.

## Who Uses It

Owner, Manager, Salesperson, Cashier, Inventory Staff, Account Staff, Production Staff, AI/Automation Operator, Viewer. Each sees only what their permissions allow; the server enforces it.

## How It Is Delivered

Four releases (R1–R4) defined in `.kiro/specs/universal-bms/release-plan.md`. R1 is the furniture business's first release in 15 working days. Work only on tasks of the current release.

## Where the Truth Lives

- What to build: `.kiro/specs/universal-bms/requirements.md`
- How to build it: `.kiro/specs/universal-bms/design.md`
- In what order: `.kiro/specs/universal-bms/tasks.md`
- Why each item exists: `.kiro/specs/universal-bms/traceability.md`

If these documents do not answer a question, ask the user. Do not guess.
