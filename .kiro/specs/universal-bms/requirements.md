# Requirements Document

## Introduction

The Universal Business Management & AI Automation System (Universal BMS) is a configurable, multi-tenant business operating system designed for small and medium businesses. It enables business owners to create a workspace, choose an industry profile, configure products and workflows, connect customer communication channels, and operate day-to-day sales and management from a single platform.

The system is industry-neutral at its core. Industry-specific behavior is expressed entirely through configuration, custom attributes, workflow rules, templates, product types, tax and payment settings, and optional modules — not through duplicated applications. The initial implementation targets a furniture business but the same core must support any industry without architectural changes.

The tech stack is: Next.js (App Router) for the frontend, NestJS for the backend API, PostgreSQL with Prisma ORM for the database, a provider-agnostic AI adapter layer, and a provider-agnostic channel (messaging) adapter layer. Background jobs use BullMQ on Redis.

This document is the complete functional scope. Nothing outside it is to be assumed: where the source specification (Developer Specification v1.0, 28 sections) names a capability, there is a requirement for it here, and `traceability.md` maps each source section to its requirements and tasks. Where a capability is deliberately excluded from this version, the requirement says so in words.

**Naming rule:** `tenantId` in this document means the identifier of the Workspace. In the database and code it is the column and field `workspaceId`. The two words always refer to the same value.

**Permission naming rule:** permissions are written `resource:action` (for example `order:create`). The eleven actions of Requirement 2.4 are applied to each resource; the full list is the Permission Catalogue in `design.md`. Where an acceptance criterion names a bare action such as `configuration` or `financial_access`, it means the permission of that action on the resource concerned.

---

## Glossary

- **Business / Tenant**: A registered organization with isolated data, configuration, and users. Each business is a separate tenant.
- **Workspace**: The operational environment associated with a single Business/Tenant.
- **Industry Profile**: A set of pre-configured attribute schemas, workflow templates, and module defaults that initialize a Workspace for a particular business type.
- **User**: An authenticated person who operates within one or more Business Workspaces, assigned one or more Roles.
- **Role**: A named collection of granular permissions assigned to Users within a Workspace.
- **Permission**: A granular authorization unit (e.g., `order:create`, `report:export`).
- **Customer**: A person or organization that purchases from a Business.
- **Lead**: A prospective customer at any stage of the sales pipeline who has not yet placed an order.
- **Conversation**: A threaded set of Messages associated with a Customer or Lead on a specific channel.
- **Product**: A catalog item that a Business sells, which may have Variants and custom Attributes.
- **Variant**: A specific sellable configuration of a Product (e.g., size, color).
- **SKU**: Stock Keeping Unit — a unique identifier for a Product Variant.
- **Order**: A confirmed commercial transaction for one or more Products between a Business and a Customer.
- **Quotation**: A pre-sale commercial document presenting prices to a prospective customer before an Order is placed.
- **POS**: Point of Sale — an in-person or local checkout session.
- **POS_Session**: A tracked cashier work period during which POS transactions are recorded.
- **Inventory_Location**: A named physical or virtual stock location (warehouse, shelf, showroom floor).
- **Stock_Movement**: An immutable ledger entry recording a quantity change for a Product Variant at an Inventory_Location.
- **Supplier**: An external entity from which the Business purchases Products.
- **Purchase_Order**: A formal request to a Supplier to supply Products at agreed prices.
- **Commission**: A calculated monetary reward assigned to a salesperson based on a completed sale.
- **Expense**: An outgoing payment made by the Business for operational costs.
- **Automation_Rule**: A configured trigger-action pair that executes without manual intervention.
- **AI_Adapter**: The provider-agnostic abstraction that routes AI requests to configured providers (OpenAI, Gemini, etc.).
- **Channel_Adapter**: The provider-agnostic abstraction that normalizes inbound and outbound messages across communication channels (WhatsApp, Facebook, Instagram, etc.).
- **Audit_Event**: An immutable record of a significant state change or action within the system.
- **Receipt**: A customer-facing document issued after a completed payment.
- **Human_Takeover**: A mode in which a human agent handles a Conversation that was previously handled by an AI or automation.
- **Field_Definition**: A configured custom field for an entity type (its key, label, type, options, rules and visibility condition).
- **Workflow**: The configured set of Workflow_States and allowed transitions for one entity type in a Workspace.
- **Workflow_State**: One status in a Workflow, with a label and an optional System_Role.
- **System_Role**: A fixed code attached to a Workflow_State (for example `CONFIRMED`) that tells the system which built-in behaviour applies, independent of the state's label.
- **Approval_Request**: A pending request for a user with the `approve` permission to allow an action (a transition, a discount, a refund, an adjustment).
- **Task**: A dated piece of work (call, follow-up, meeting, reminder, to-do) assigned to a user and linked to a record.
- **Notification**: An in-app (and optionally email) alert for a user about an event.
- **File_Asset**: The record of one stored file and the entity it is attached to.
- **Invoice**: A numbered customer-facing financial document issued for an Order.
- **Price_List**: A named set of Variant prices that can be assigned to Customers.
- **Stock_Level**: The maintained on-hand, reserved and available quantities of a Variant at an Inventory_Location.
- **Stock_Reservation**: A quantity of a Variant held for a confirmed Order line and not yet deducted.
- **Production_Job**: The production work for one custom Order line, with its own status, assignee and due date.
- **Financial_Account**: A cash, bank, mobile wallet or card terminal account that money is received into or paid from.
- **AI_Suggestion**: One AI output (extraction, draft reply, summary, classification) awaiting or carrying a human decision.
- **Knowledge_Item**: An approved piece of business information (policy or question-and-answer) the AI may use.
- **Domain_Event**: A named internal event (for example `order.status_changed`) published by a module for other modules to react to.
- **Platform_Admin**: An operator of the whole platform who manages Workspaces but not their business data.
- **Release**: A delivery stage. R1 is the first release for the furniture business; R2, R3 and R4 are the later stages defined in `release-plan.md`.

---

## Requirements

### Requirement 1: Multi-Tenant Business Workspace

**User Story:** As a business owner, I want to create and manage an isolated workspace for my business, so that my data, users, and configuration are completely separated from other businesses on the platform.

#### Acceptance Criteria

1. THE System SHALL provide an API endpoint that accepts a business name, industry profile selection, and owner user credentials, and creates a new Tenant with an isolated Workspace.
2. WHEN a Tenant is created, THE System SHALL generate a unique `tenantId` and associate all subsequent entities (Users, Products, Customers, Orders, etc.) created within that Workspace with that `tenantId`.
3. WHILE processing any API request, THE System SHALL enforce that all database queries include a `tenantId` filter matching the authenticated user's Workspace, so that no cross-tenant data leakage occurs.
4. IF a request attempts to access, modify, or delete a resource belonging to a different `tenantId`, THEN THE System SHALL reject the request with an HTTP 403 Forbidden response and log an Audit_Event.
5. THE System SHALL support at least one active Industry Profile (furniture) at initial launch, and THE System SHALL allow new Industry Profiles to be added through configuration without code changes.
6. WHEN a Tenant selects an Industry Profile during setup, THE System SHALL apply the corresponding attribute schemas, workflow templates, and module defaults to that Workspace.
7. THE System SHALL allow a business owner to update their Workspace settings (business name, branding, bank details, receipt format, timezone, currency) at any time without disrupting active sessions.

---

### Requirement 2: Authentication and Authorization

**User Story:** As a system operator, I want to authenticate users with secure tokens and enforce granular role-based permissions, so that only authorized actions are possible within each Workspace.

#### Acceptance Criteria

1. WHEN a user submits valid credentials, THE Auth_Service SHALL issue a signed JWT access token with a configurable expiry and a refresh token stored server-side.
2. WHEN a JWT access token expires, THE Auth_Service SHALL accept a valid refresh token and issue a new access token without requiring re-authentication.
3. IF a refresh token is revoked or expired, THEN THE Auth_Service SHALL return HTTP 401 Unauthorized and require full re-authentication.
4. THE System SHALL define the following granular permission actions: `view`, `create`, `edit`, `delete/archive`, `approve`, `export`, `refund`, `financial_access`, `configuration`, `integration_access`, `ai_control_access`; each permission SHALL be the combination of a resource and an action, and the complete catalogue SHALL be defined in one place in code and shown in the role editor.
5. THE System SHALL enforce permissions server-side on every NestJS controller action, such that no client-side bypass can grant unauthorized access.
6. WHEN an authenticated user attempts an action they lack permission for, THE System SHALL return HTTP 403 Forbidden and log an Audit_Event recording the user, the attempted action, and the timestamp.
7. THE System SHALL support multiple Roles per User within a single Workspace, with permissions being the union of all assigned Roles.
8. THE System SHALL provide a default Role set: Owner (all permissions), Manager (all except configuration and integration), Salesperson (view, create, edit on CRM, Conversations, Quotations and assigned Orders; POS access), Cashier (POS, payments, receipts and customer lookup), Inventory Staff (products, stock, purchases and inventory movements), Account Staff (payments, expenses, financial reports and reconciliation), Production Staff (assigned Production_Jobs with their specifications), AI/Automation Operator (automation settings, AI controls and monitored Conversations), and Viewer (view-only on assigned modules).
9. THE System SHALL require an elevated permission, separate from ordinary edit rights, for each sensitive action: refund, payment void, price override, discount above the Role limit, stock adjustment above threshold, order completion with a balance due, and permission changes.

---

### Requirement 3: User and Role Management

**User Story:** As a business owner, I want to invite users, assign roles, and manage permissions, so that each team member has appropriate access to the system.

#### Acceptance Criteria

1. THE User_Service SHALL allow a user with the `configuration` permission to invite new users to a Workspace by email, generating a time-limited invitation token.
2. WHEN an invited user accepts the invitation and sets a password, THE System SHALL activate their account and assign the specified Role(s).
3. THE System SHALL allow a user with the `configuration` permission to create, rename, and delete custom Roles within their Workspace.
4. WHEN a Role is deleted, THE System SHALL reassign all users holding that Role to a fallback Role specified at deletion time.
5. THE System SHALL allow a user with the `configuration` permission to enable or disable individual permissions on any non-Owner Role.
6. THE System SHALL prevent the last Owner of a Workspace from being demoted or removed.
7. WHEN a user is deactivated, THE System SHALL immediately invalidate all their active sessions and prevent new logins without deleting their historical records.

---

### Requirement 4: Audit Framework

**User Story:** As a business owner and compliance officer, I want an immutable audit trail of all significant system actions, so that I can trace every change for accountability and troubleshooting.

#### Acceptance Criteria

1. THE Audit_Service SHALL record an Audit_Event for every create, update, delete, approval, export, login, permission change, and financial transaction within a Workspace.
2. THE Audit_Event record SHALL contain: `eventId`, `tenantId`, `actorUserId`, `actorRole`, `action`, `entityType`, `entityId`, `previousState` (JSON), `newState` (JSON), `ipAddress`, and `timestamp`.
3. THE System SHALL store Audit_Events in an append-only table where no application code path allows UPDATE or DELETE operations on existing records, and the database itself SHALL reject UPDATE and DELETE on that table.
4. WHEN a user with `configuration` permission queries the audit log, THE System SHALL return a paginated, filterable list of Audit_Events for their Workspace only.
5. IF the audit log write fails, THEN THE System SHALL not silently discard the event; THE System SHALL retry the write and alert via the monitoring system if retry fails.
6. THE Audit_Service SHALL write the Audit_Event for a data change inside the same database transaction as the change, so that a change cannot exist without its Audit_Event.
7. THE Audit_Service SHALL also record automation actions, AI actions, security events and integration errors, as required by Requirements 17.3, 18.8, 20.6 and 24.4.

---

### Requirement 5: Settings and Configuration Framework

**User Story:** As a business owner, I want to configure all aspects of my Workspace through a settings interface, so that the system behaves correctly for my specific business needs.

#### Acceptance Criteria

1. THE Settings_Service SHALL provide a structured configuration namespace per Workspace covering: business profile, branding (logo, colors), receipt template, tax settings, currency, timezone, commission rules, automation rules, module toggles, terminology, document numbering formats, inventory rules (negative stock, valuation), discount limits, deposit rules, AI settings, messaging settings (business hours, opt-out keywords) and data retention periods.
2. WHEN a configuration value is changed, THE Settings_Service SHALL record an Audit_Event and apply the new value to all subsequent operations without requiring a system restart.
3. THE System SHALL allow module-level feature flags (e.g., enable/disable AI, enable/disable commission tracking) that take effect immediately on save.
4. THE System SHALL validate all configuration inputs against defined schemas before persisting, returning descriptive validation errors for any violation.

---

### Requirement 6: Universal Product Catalog

**User Story:** As a business owner, I want to define products with categories, variants, custom attributes, and pricing, so that my entire catalog is represented accurately regardless of industry.

#### Acceptance Criteria

1. THE Catalog_Service SHALL allow creation of Products with: name, description, category, base price, cost price, tax class, status (active/inactive/archived), and images.
2. THE Catalog_Service SHALL allow each Product to have zero or more Variants, each identified by a unique SKU, with its own price override, cost override, weight, and attribute values.
3. THE System SHALL support the following custom Attribute types: `text`, `number`, `date`, `boolean`, `dropdown`, `multi-select`, `measurement` (value + unit), `currency`, `image`, `reference` (link to another entity).
4. WHEN an Industry Profile is applied, THE System SHALL automatically create the standard Attribute set for that industry (e.g., width, depth, height, material, color, finish for the furniture profile) without requiring manual attribute definition.
5. THE Catalog_Service SHALL allow custom Attributes to be defined at the Product Category level, so that all Products within a Category automatically inherit those Attributes.
6. THE Catalog_Service SHALL enforce that every active Variant has a valid, unique SKU.
7. WHEN a Product is archived, THE System SHALL retain all historical records referencing that Product and prevent new Orders from being created for it.
8. THE System SHALL support product bundling, allowing a Bundle Product to reference component Products, with bundle pricing and stock managed independently from components.

---

### Requirement 7: Inventory Management

**User Story:** As a warehouse manager, I want to track stock levels, movements, and supplier relationships, so that I always know what is available and can fulfill orders reliably.

#### Acceptance Criteria

1. THE Inventory_Service SHALL maintain a Stock_Movement ledger that records every quantity change (sale, purchase receipt, adjustment, transfer, return) as an immutable entry.
2. EACH Stock_Movement entry SHALL contain: `movementId`, `tenantId`, `variantSku`, `locationId`, `movementType`, `quantityDelta`, `referenceType` (order/purchase/adjustment), `referenceId`, `performedByUserId`, and `timestamp`.
3. THE Inventory_Service SHALL calculate current available stock for any Variant at any Inventory_Location as: `sum(stockMovements.quantityDelta)` for that variant/location combination.
4. THE Inventory_Service SHALL support reserved stock, reducing available-to-sell quantity when an Order is confirmed, and releasing the reservation if the Order is cancelled.
5. WHEN the available stock for a Variant falls below the configured minimum stock level, THE Inventory_Service SHALL trigger a low-stock alert visible in the dashboard and optionally via automation.
6. THE Inventory_Service SHALL support multiple Inventory_Locations, allowing stock transfers between locations to be recorded as paired Stock_Movements (negative at source, positive at destination).
7. WHERE the Industry Profile enables batch/expiry/serial tracking, THE Inventory_Service SHALL record batch number, expiry date, or serial number on each Stock_Movement entry.
8. THE System SHALL support Purchase Orders to Suppliers, recording ordered quantities, expected delivery date, and per-item cost.
9. WHEN a Purchase Order is received (partially or fully), THE Inventory_Service SHALL create positive Stock_Movement entries for the received quantities and update the Purchase Order status accordingly.

---

### Requirement 8: CRM — Customer Master

**User Story:** As a salesperson, I want to manage a unified customer record with full contact details, notes, history, and tags, so that every team member has complete context when dealing with a customer.

#### Acceptance Criteria

1. THE CRM_Service SHALL store Customers with: full name, phone numbers (multiple), email, billing address, shipping address, preferred contact channel, notes, tags, source (how they found the business), assigned staff member, and account status.
2. THE CRM_Service SHALL detect potential duplicate Customers using configurable matching rules (default: normalized phone number or email address; optionally also similar name), presenting matches to the user before saving.
3. WHEN a duplicate is confirmed, THE System SHALL merge the duplicate records, consolidating Orders, Conversations, and payment history under the surviving record and archiving the duplicate.
4. THE System SHALL provide a chronological Conversation/timeline view on each Customer record showing all interactions: messages, Orders, Payments, notes, and status changes.
5. THE CRM_Service SHALL allow filtering and searching of Customers by name, phone, email, tag, assigned staff, and source.
6. THE System SHALL track the Customer's lifetime order value, total payments made, and outstanding balance as computed fields derived from linked records.

---

### Requirement 9: CRM — Lead Pipeline

**User Story:** As a sales manager, I want to manage leads through a configurable pipeline with stages, assignments, and conversion tracking, so that no opportunity is missed and conversion rates are measurable.

#### Acceptance Criteria

1. THE Lead_Service SHALL support a configurable pipeline with the following default stages: `New`, `Contacted`, `Qualified`, `Quoted`, `Negotiation`, `Won`, `Lost`; additional stages SHALL be addable through configuration.
2. WHEN a Lead is created (manually or via automation/AI), THE Lead_Service SHALL assign it a `leadId`, `tenantId`, stage, source channel, contact details, and optionally an assigned salesperson; a Lead SHALL also hold: campaign or source label, interested product, requirements (free text and structured custom fields), reference images, quantity, estimated value, priority, next action and follow-up date.
3. THE Lead_Service SHALL record a timestamped history entry every time the Lead's stage, assigned staff, or key fields change.
4. THE Lead_Service SHALL allow a user to convert a Lead to a Customer, Quotation, or Order, carrying over all contact details, requirements, attachments, source attribution and conversation history; in this system an "opportunity" is a Lead in a qualified stage and is not a separate record.
5. WHEN a Lead is marked as `Lost`, THE System SHALL require selection of a Lost Reason from a configurable list, and THE System SHALL record this for pipeline analytics.
6. THE System SHALL generate pipeline analytics showing: count and value by stage, average time in each stage, conversion rate from Lead to Order, and top Lost Reasons.
7. THE Lead_Service SHALL prevent duplicate Lead creation for the same contact within a configurable deduplication window (default 24 hours), surfacing the existing Lead instead.

---

### Requirement 10: Quotations

**User Story:** As a salesperson, I want to create quotations with line items, discounts, and expiry dates, so that customers receive formal pre-sale documents that can be converted to Orders.

#### Acceptance Criteria

1. THE Quotation_Service SHALL allow creation of a Quotation linked to a Customer or Lead, with: line items (product/variant, quantity, unit price, discount), sub-total, tax breakdown, total, validity expiry date, and notes.
2. THE Quotation_Service SHALL generate a unique quotation number in a configurable format (e.g., `QT-2025-0001`).
3. WHEN a Quotation is sent to the customer, THE System SHALL record the send event and allow tracking whether the customer has viewed it (if delivered via a tracked channel).
4. WHEN a Quotation is accepted by the customer, THE System SHALL allow one-click conversion to an Order, preserving all line items, pricing, and customer details.
5. IF a Quotation's validity date passes without conversion, THEN THE System SHALL mark it as `Expired` and exclude it from active pipeline counts.
6. THE Quotation_Service SHALL support version history, so that if a Quotation is revised, the previous version is retained and accessible.

---

### Requirement 11: Orders

**User Story:** As a sales manager, I want to manage orders through a complete lifecycle from creation to fulfillment, so that every order is traceable from placement to delivery.

#### Acceptance Criteria

1. THE Order_Service SHALL support the following default status lifecycle: `Draft` → `Confirmed` → `Deposit_Paid` → `In_Production` → `Ready` → `Out_for_Delivery` → `Delivered` → `Completed`; with side states `Cancelled`, `Refunded`, `On_Hold`.
2. THE Order_Service SHALL allow the status lifecycle stages to be renamed, reordered (except terminal states), and extended through Workspace configuration.
3. WHEN an Order status changes, THE Order_Service SHALL record a timestamped status history entry including the actor's `userId`.
4. EACH Order SHALL contain: `orderId`, `tenantId`, `customerId`, order date, delivery date, line items (product/variant/sku, quantity, unit price, discount, custom attribute values for that line), sub-total, tax, total, deposit amount, balance due, delivery address, assigned staff, and internal notes.
5. THE Order_Service SHALL calculate and display balance due as `total - sum(payments.amount)` in real time.
6. WHEN an Order is confirmed, THE Inventory_Service SHALL reserve the ordered quantities across the relevant Inventory_Locations.
7. WHEN an Order is Cancelled, THE Inventory_Service SHALL release all inventory reservations for that Order and THE Commission_Service SHALL reverse any pending commissions.
8. THE Order_Service SHALL link to all associated Payments, Conversations, Quotations, and Audit_Events for full traceability.

---

### Requirement 12: Point of Sale (POS)

**User Story:** As a cashier, I want to process walk-in sales quickly through a POS interface, so that customers are served efficiently and all transactions are recorded correctly.

#### Acceptance Criteria

1. THE POS_Service SHALL require a cashier to open a POS_Session before processing transactions, recording the opening cashier `userId`, opening time, and opening float amount.
2. WHEN a POS checkout is completed, THE POS_Service SHALL create an Order and a linked Payment record, update Inventory Stock_Movements, and generate a Receipt — all within a single atomic transaction.
3. THE POS_Service SHALL support the following payment methods: cash, card (POS device), bank transfer, and mobile money; and SHALL support split payments across two or more methods in a single transaction.
4. THE POS_Service SHALL calculate change due automatically for cash payments and display it to the cashier before finalizing the transaction.
5. THE Receipt generated by THE POS_Service SHALL contain: business name, logo, address and contact details, transaction number, date and time, cashier, customer where one is selected, itemized list with quantities and prices, discounts, sub-total, tax breakdown where tax applies, payment method(s), total, amount paid, balance or change, and any configured custom footer text.
6. THE Receipt SHALL be generated as a PDF laid out for thermal receipt paper (58mm or 80mm width, configurable) and for A4, printed through the browser's print function on whatever printer the device has installed; a plain-text ESC/POS thermal output MAY be added later behind the Print Output adapter (Requirement 48.5).
7. WHEN a cashier closes a POS_Session, THE POS_Service SHALL calculate the expected closing balance, record the actual counted amount entered by the cashier, and flag any discrepancy.
8. THE POS_Service SHALL allow a user with the `refund` permission to process returns and refunds from within a POS_Session, reversing stock movements and generating a refund receipt.
9. THE POS_Service SHALL calculate and record a Commission entry for the assigned salesperson at the time the POS transaction is finalized.
10. THE POS_Service SHALL allow a sale to a selected Customer or to a walk-in customer, using one system walk-in Customer record per Workspace.
11. THE POS screen SHALL find products by name, SKU, alias and barcode, and SHALL add a scanned barcode's Variant to the cart directly.
12. THE POS cart SHALL support quantity, unit price, line discount, order discount and applicable tax, calculated as in Requirement 35.
13. THE POS_Service SHALL record the salesperson attributed to each sale, defaulting to the cashier.
14. THE POS_Service SHALL allow any Receipt to be reprinted (Requirement 29.8).
15. THE POS_Service SHALL provide a daily closing that produces the POS Daily Closing report (Requirement 44.3) and locks the closed POS_Session against further sales.
16. THE POS_Service SHALL record cash paid in and paid out of the drawer during a POS_Session, with a reason, and include it in the expected closing balance.

---

### Requirement 13: Financial Layer — Payments and Expenses

**User Story:** As a business owner, I want to record all payments (customer receipts and supplier disbursements) and expenses, so that I have an accurate picture of cash flow and outstanding balances.

#### Acceptance Criteria

1. THE Payment_Service SHALL allow recording of customer payments against Orders or as advance/deposit payments, with: amount, date, payment method, receiving Financial_Account, reference number, status (Requirement 40.5), and optionally an attachment.
2. THE Payment_Service SHALL allow recording of supplier payments against Purchase Orders, with: amount, date, payment method, and reference number.
3. THE Expense_Service SHALL allow recording of business expenses with: category, amount, date, payment method, description, and an optional attachment (receipt image).
4. THE System SHALL maintain a real-time receivables summary per Customer: total invoiced, total paid, and balance outstanding.
5. THE System SHALL maintain a real-time payables summary per Supplier: total ordered, total paid, and balance outstanding.
6. WHEN a payment is recorded, THE System SHALL update the linked Order's balance due immediately.
7. IF a payment amount causes a Customer's balance to go negative (overpayment), THEN THE Payment_Service SHALL flag this and record the credit balance for future application.
8. THE System SHALL require the `financial_access` permission to view financial summaries, payment records, and expense records.
9. THE Expense_Service SHALL maintain a configurable list of expense categories and SHALL allow an Expense to be voided with a reason, never edited after posting.
10. THE System SHALL record an Audit_Event with old and new values for every payment or expense void, cancellation and reversal.

---

### Requirement 14: Commission Engine

**User Story:** As a sales manager, I want to automatically calculate, approve, and track salesperson commissions, so that the team is compensated accurately and disputes are minimized.

#### Acceptance Criteria

1. THE Commission_Service SHALL support commission rules defined as: a percentage of the configured commission base, a fixed amount per order, or a fixed amount per unit sold; scoped to: all products, a specific Category, a specific Product, an order type, and optionally a specific salesperson (Requirements 41.4 and 41.5).
2. WHEN an Order reaches a configurable trigger status (default: `Completed`), THE Commission_Service SHALL automatically calculate the commission for the assigned salesperson based on applicable rules and create a Commission record with status `Pending`.
3. THE Commission record SHALL contain: `commissionId`, `tenantId`, `salespersonId`, `orderId`, `calculationBase`, `ruleApplied`, `amount`, `status`, and `timestamp`.
4. THE System SHALL require a user with `approve` permission to change a Commission status from `Pending` to `Approved` or `Rejected`.
5. WHEN a Commission is `Approved`, a user with `financial_access` can mark it as `Paid`, recording the payment date and method.
6. WHEN an Order associated with a Commission is Cancelled or Refunded, THE Commission_Service SHALL automatically set the Commission status to `Reversed` regardless of current status.
7. THE Commission_Service SHALL generate a Commission Statement report filterable by salesperson, date range, and status.

---

### Requirement 15: Channel Adapter Framework

**User Story:** As a business owner, I want to connect multiple communication channels (WhatsApp, Facebook, Instagram) through a single interface, so that all customer messages are managed in one place regardless of origin.

#### Acceptance Criteria

1. THE Channel_Adapter SHALL provide a provider-agnostic interface with methods: `sendMessage(channelType, recipient, content)`, `receiveMessage(rawPayload) → NormalizedMessage`, and `getConversationHistory(channelType, externalId)`.
2. WHEN an inbound message arrives on any connected channel, THE Channel_Adapter SHALL normalize it into a standard `NormalizedMessage` struct containing: `messageId`, `tenantId`, `channelType`, `externalSenderId`, `externalConversationId`, `body`, `attachments`, `timestamp`, and `direction` (`inbound`).
3. THE System SHALL link every inbound message to an existing Customer or Lead if a matching phone/email is found, or create a new Lead automatically if no match exists.
4. THE System SHALL support webhook endpoints for the WhatsApp Business Platform, Facebook Lead Ads and Instagram messaging, including each provider's webhook verification handshake, with additional providers addable without modifying existing adapter code.
5. THE Channel_Adapter SHALL implement webhook idempotency by storing processed `externalMessageId` values and discarding duplicate deliveries within a 24-hour deduplication window.
6. WHEN a webhook delivery fails to be processed, THE System SHALL retry the processing up to 3 times with exponential backoff before logging a permanent failure Audit_Event.
7. THE System SHALL require webhook signature verification for every inbound webhook to prevent spoofed events.
8. THE System SHALL identify the Workspace of an inbound webhook from the provider account identifier in the payload (for example the receiving phone number identifier), matched against the stored integration connection; a webhook that matches no connection SHALL be acknowledged, logged and not processed.
9. THE System SHALL acknowledge a webhook to the provider only after it has been durably stored for processing.

---

### Requirement 16: Messaging — Conversations and Templates

**User Story:** As a salesperson, I want to send and receive messages from within a customer record using templates and quick replies, so that communication is fast, consistent, and fully logged.

#### Acceptance Criteria

1. THE Conversation_Service SHALL maintain a Conversation record per Customer/Lead per Channel, containing an ordered list of Messages with sender, direction, body, attachments, and timestamp.
2. THE System SHALL allow a user to send an outbound message to a Customer or Lead from within the Conversation view, routing it through the appropriate Channel_Adapter.
3. THE System SHALL provide configurable Message Templates with named variables (e.g., `{{customer_name}}`, `{{order_total}}`), which are resolved at send time.
4. THE System SHALL provide configurable Quick Reply options that a user can select to instantly send a pre-written message.
5. WHEN a user manually sends a message or takes over a Conversation, THE Conversation_Service SHALL set the Conversation's `automationActive` flag to `false` for that Conversation.
6. THE System SHALL allow a user with `configuration` permission to re-enable automation for a Conversation.
7. THE System SHALL support a global automation toggle at the Workspace level that overrides per-Conversation settings.

---

### Requirement 17: Automation Engine

**User Story:** As a business owner, I want to configure trigger-based automation rules that send messages, create leads, and set reminders without manual intervention, so that no customer touchpoint is missed.

#### Acceptance Criteria

1. THE Automation_Engine SHALL evaluate Automation_Rules against system events (e.g., Lead created, Order status changed, stock below minimum, N days since last contact) and execute the configured action when the trigger condition is met.
2. THE Automation_Engine SHALL support the following action types: send message (via Channel_Adapter), create/update Lead, create reminder task, send internal notification, update Order status.
3. WHEN an Automation_Rule fires, THE Automation_Engine SHALL record an Audit_Event with: ruleId, triggeredBy, targetEntityId, actionTaken, and outcome (success/failure).
4. IF an automation action fails (e.g., message delivery failure), THEN THE Automation_Engine SHALL log the failure and, if the rule is configured for retry, attempt re-execution up to a configurable maximum.
5. THE System SHALL allow a user with `configuration` permission to create, modify, enable, disable, and delete Automation_Rules.
6. WHEN the global automation toggle is set to OFF for a Workspace, THE Automation_Engine SHALL not execute any message-sending automation for that Workspace.

---

### Requirement 18: AI Adapter Layer

**User Story:** As a business operator, I want AI to assist with extracting requirements from conversations, classifying leads, and drafting replies, while keeping all AI outputs reviewable by humans before they take effect.

#### Acceptance Criteria

1. THE AI_Service SHALL provide the provider-agnostic functions `extractRequirements(conversationHistory) → StructuredRequirements`, `classifyLead(conversationHistory) → LeadClassification`, `draftReply(context) → DraftMessage` and `summarizeConversation(messages) → Summary`, plus those of Requirement 43.1; THE AI_Adapter beneath it SHALL expose only two provider-neutral methods, `generateStructured(request)` and `generateText(request)`, so that prompts and business rules are written once and not per provider.
2. THE AI_Adapter SHALL route requests to the configured AI provider (OpenAI, Google Gemini, or other) using a Workspace-level provider setting, without requiring code changes to switch providers.
3. WHEN THE AI_Adapter produces output, THE System SHALL attach a confidence score and flag any fields where confidence is below a configurable threshold.
4. THE System SHALL never commit AI-extracted data (customer details, product requirements, financial figures) to production records without an explicit human approval action.
5. THE System SHALL provide an AI ON/OFF toggle at the Workspace level and a per-Conversation AI ON/OFF toggle, both controllable by users with `ai_control_access` permission.
6. WHEN AI is disabled (globally or per Conversation), THE System SHALL not send any data to the AI provider for that scope and SHALL display a clear indicator to users.
7. THE AI_Adapter SHALL include the Workspace's Industry Profile context in every prompt to ensure industry-relevant responses.
8. THE System SHALL maintain an AI Action Audit Log recording: provider used, model version, prompt hash, response hash, confidence scores, human approval status, and approving user, for every AI action.
9. THE System SHALL define escalation rules such that if AI confidence falls below a threshold or the message matches an escalation keyword, the Conversation is flagged for immediate human review.
10. THE System SHALL prohibit AI from autonomously initiating financial commitments (price quotes, discounts, refunds) — such actions SHALL always require human confirmation.

---

### Requirement 19: Reporting and Analytics

**User Story:** As a business owner and manager, I want role-appropriate dashboards and exportable reports, so that I can make informed business decisions based on accurate, real-time data.

#### Acceptance Criteria

1. THE Reporting_Service SHALL provide a role-aware dashboard displaying KPIs relevant to the user's Role: sales totals, lead counts, open orders, low-stock alerts, and pending commissions.
2. THE Reporting_Service SHALL provide pre-built reports: Sales by Date (today/week/month/custom), Sales by Product, Sales by Category, Sales by Salesperson, Lead Pipeline, Conversion Rate, Profit/Loss (Gross Sales minus COGS = Gross Profit; Gross Profit minus Expenses = Net Profit), Stock Inventory, Commission Statements, and Payment Method Breakdown.
3. THE Reporting_Service SHALL allow custom report creation (admin only) by selecting dimensions and measures from available data fields.
4. ALL report totals SHALL reconcile to source transaction records, with the ability to drill down from any aggregate figure to the underlying records.
5. THE Reporting_Service SHALL support date range filters on all reports.
6. THE System SHALL require the `export` permission for a user to export any report as CSV or PDF.
7. WHEN a report is exported, THE System SHALL record an Audit_Event noting the user, report type, filters applied, and timestamp.
8. THE System SHALL enforce that users without `financial_access` permission cannot view revenue, cost, profit, or payment-related figures in any report or dashboard widget.

---

### Requirement 20: Security and Tenant Isolation

**User Story:** As a platform operator, I want the system to enforce strict security controls and tenant isolation, so that no business data can be accessed by unauthorized parties under any circumstances.

#### Acceptance Criteria

1. THE System SHALL enforce tenant isolation at the database query level using a Prisma Client extension that automatically injects the Workspace identifier into every read and write operation (including bulk, upsert, aggregate and group-by operations) for tenant-scoped entities; every tenant-scoped table SHALL carry a non-null `workspaceId` column.
2. THE System SHALL validate all user inputs server-side using schema validation (class-validator in NestJS) and SHALL use parameterized queries exclusively to prevent SQL injection.
3. THE System SHALL implement rate limiting on all public API endpoints, rejecting requests exceeding configured thresholds with HTTP 429.
4. THE System SHALL verify signatures on all inbound webhook payloads using the provider's signing secret before processing.
5. THE System SHALL encrypt all data at rest using the hosting platform's encryption-at-rest capability and transmit all data over TLS 1.2 or higher.
6. WHEN a security violation is detected (invalid tenant access, failed signature verification, repeated auth failure), THE System SHALL record an Audit_Event and, after a configurable threshold, temporarily block the source IP.
7. THE System SHALL separate environments: development, staging, and production, each with isolated databases and configuration.
8. THE System SHALL never log sensitive data (passwords, payment card numbers, API keys, JWT secret values) in application logs.
9. THE System SHALL encode all user-supplied content on output and SHALL send security headers (content security policy, strict transport security, no content-type sniffing) on every response.
10. THE System SHALL return error responses that contain no stack trace, query text, secret or internal path.
11. THE System SHALL apply least privilege: each default Role holds only the permissions its work requires, and the application's database account holds only the rights the application needs.
12. THE System SHALL NOT store payment card numbers.

---

### Requirement 21: Performance and Reliability

**User Story:** As a user of the system, I want the application to respond quickly and remain available during normal business hours, so that my daily operations are not disrupted.

#### Acceptance Criteria

1. THE System SHALL return API responses for standard CRUD operations within 500ms at the 95th percentile under a load of 100 concurrent users.
2. THE System SHALL return report generation responses within 5 seconds for datasets up to 12 months of transactions.
3. WHEN an external service (AI provider, channel provider) is unavailable, THE System SHALL return a graceful error and continue operating all non-dependent core functions.
4. THE System SHALL implement database connection pooling, SHALL paginate every list endpoint, and SHALL back every list filter and sort with a database index.
5. THE System SHALL implement background job processing (using a queue) for non-real-time operations: report generation, bulk exports, AI processing, and automation rule evaluation.

---

### Requirement 22: Data Integrity and Migration

**User Story:** As a system administrator, I want database schema changes to be versioned and migrations to be reversible, so that deployments do not cause data loss.

#### Acceptance Criteria

1. THE System SHALL manage all database schema changes through Prisma migrations, with every migration committed to version control.
2. EVERY Prisma migration SHALL be accompanied by a reviewed rollback SQL script stored beside it (Prisma generates forward migrations only), except where the migration is irreversible, in which case that SHALL be stated in the migration's notes.
3. THE System SHALL validate that all migrations pass on a staging environment before deployment to production.
4. THE System SHALL support point-in-time database backups with a recovery point objective of no more than 24 hours.
5. WHEN a migration fails during deployment, THE System SHALL automatically rollback to the previous schema version and alert the operations team.

---

### Requirement 23: Printing and Document Generation

**User Story:** As a cashier and operations manager, I want system-generated receipts and documents to print correctly on standard thermal printers and export cleanly to PDF, so that customers always receive accurate documentation.

#### Acceptance Criteria

1. THE Document_Service SHALL generate receipts as PDF in 58mm, 80mm and A4 layouts, selectable through Workspace configuration, readable on thermal printers at those widths.
2. THE Document_Service SHALL generate a PDF version of any receipt, quotation, order confirmation, invoice, refund receipt or purchase order on demand (Requirement 29).
3. WHEN printing a receipt, THE Document_Service SHALL include all fields from Requirement 12.5 and apply the Workspace's configured branding (logo in PDF, business name text in thermal).
4. THE Document_Service SHALL support Arabic and other right-to-left languages in PDF output where the Workspace locale requires it.
5. THE Document_Service SHALL number all receipts and quotations sequentially using a configurable prefix and zero-padded counter (e.g., `RCP-2025-00001`).

---

### Requirement 24: Integration Extensibility

**User Story:** As a platform developer, I want all external integrations to be behind adapter interfaces, so that new providers can be added without changing core business logic.

#### Acceptance Criteria

1. THE System SHALL define a `ChannelAdapterInterface` that any new messaging provider must implement to be registered in the system.
2. THE System SHALL define an `AIAdapterInterface` (Requirement 18.1) that any new AI provider must implement to be registered in the system.
3. THE System SHALL register active adapters through a configuration-driven provider registry, so that adding a new provider requires only implementing the interface and adding a configuration entry.
4. WHEN an adapter method throws an unhandled exception, THE System SHALL catch it at the adapter boundary, log it as an Audit_Event, and surface a normalized error to the calling service — never propagating raw provider errors to the UI.
5. THE System SHALL expose a Workspace-level integration settings page where users with `integration_access` permission can connect, disconnect, and configure each integration.

---

### Requirement 25: Monorepo and Project Structure

**User Story:** As a developer, I want the codebase organized in a monorepo with clear separation between frontend, backend, and shared packages, so that code is reusable, maintainable, and consistently structured.

#### Acceptance Criteria

1. THE Codebase SHALL be organized as a monorepo with the following top-level directories: `apps/web` (Next.js App Router frontend), `apps/api` (NestJS backend), and `packages/*` (shared types, utilities, and configuration).
2. THE `apps/api` directory SHALL be structured into NestJS feature modules, one per domain: `auth`, `tenants`, `users`, `catalog`, `inventory`, `purchasing`, `crm`, `tasks`, `orders`, `production`, `pos`, `payments`, `commissions`, `channels`, `ai`, `automation`, `notifications`, `reporting`, `audit`, `settings`, `fields`, `workflows`, `documents`, `files`, `search`, `imports`, `integrations`, `platform`, `health`.
3. THE `apps/web` directory SHALL use Next.js App Router conventions with route groups organized by business domain, and SHALL consume all backend data exclusively through the NestJS API (no direct database access from the frontend).
4. THE `packages/types` package SHALL contain shared TypeScript interface definitions for all core domain entities used by both `apps/api` and `apps/web`.
5. THE System SHALL use environment variables for all secrets, connection strings, and provider API keys, with no hardcoded credentials anywhere in the codebase.

---

### Requirement 26: Custom Fields and Conditional Fields

**User Story:** As a business owner, I want to add my own fields to products, customers, leads, orders and other records, so that the system captures what my industry needs without a developer changing the code.

#### Acceptance Criteria

1. THE Field_Service SHALL allow a user with the `configuration` permission to create, edit, reorder and deactivate Field_Definitions for these entity types: Product, Variant, Order line, Quotation line, Customer, Lead, Order, Quotation, Supplier, Purchase_Order and Expense.
2. EACH Field_Definition SHALL contain: `key` (unique per Workspace and entity type, immutable after first use), label, type (the ten types listed in Requirement 6.3), unit (for `measurement`), options (for `dropdown` and `multi-select`), required flag, default value, display order, optional Category scope, optional visibility condition, a variant-axis flag, and an active flag.
3. WHEN a record is created or updated, THE System SHALL validate its custom field values server-side against the active Field_Definitions (type, required, option membership, unit) and SHALL reject invalid values with HTTP 400 and field-level errors.
4. WHERE a Field_Definition has a visibility condition, THE System SHALL display and require that field only when the condition is true; conditions SHALL be able to reference product type, Category, record status and the value of another field on the same record.
5. THE System SHALL evaluate visibility conditions with one shared function used by both the API and the web application, so that both always agree.
6. WHEN a Field_Definition is deactivated, THE System SHALL keep its stored values on existing records and SHALL stop showing it on new records.
7. THE System SHALL allow list endpoints for Products, Customers, Leads and Orders to be filtered by custom field value (equality for all types; range for `number`, `date`, `currency` and `measurement`).
8. WHEN an Order line or Quotation line is saved, THE System SHALL store a snapshot of each custom field's label, value and unit on the line, so that later changes to a Field_Definition do not alter historical documents.
9. THE System SHALL require no code change, deployment or database migration to add, change or deactivate a Field_Definition.

---

### Requirement 27: Configurable Workflows, Statuses and Approvals

**User Story:** As a business owner, I want to define the statuses and steps my leads, orders, purchases and production work move through, so that the system follows my process instead of a fixed one.

#### Acceptance Criteria

1. THE System SHALL store, per Workspace, one Workflow for each of: Lead, Order, Purchase_Order and Production_Job; each Workflow consists of Workflow_States and the allowed transitions between them.
2. EACH Workflow_State SHALL contain: `key`, label, colour, display order, category (`open`, `in_progress`, `done`, `cancelled`) and an optional System_Role.
3. THE System SHALL attach business side effects to System_Roles and never to labels or keys, as follows: Order `CONFIRMED` reserves stock; Order `CANCELLED` releases reservations and reverses commissions; Order `DELIVERED` converts reservations into stock deductions; Order `COMPLETED` is the default commission trigger; Lead `WON` and `LOST` close the Lead; Purchase_Order `RECEIVED` and `PARTIALLY_RECEIVED` are set by goods receipt.
4. THE System SHALL prevent a user from deleting a Workflow_State that is in use by any record, and from removing a System_Role that the Workflow requires (Order: `DRAFT`, `CONFIRMED`, `DELIVERED`, `COMPLETED`, `CANCELLED`; Lead: `NEW`, `WON`, `LOST`).
5. EACH transition SHALL be able to define: a required permission, a list of fields that must be filled before the transition, and whether the transition requires approval.
6. WHEN a requested transition is not allowed from the record's current state, THE System SHALL return HTTP 422 with the list of allowed target states.
7. WHEN a transition requires approval, THE System SHALL create an Approval_Request, leave the record in its current state, and apply the transition only when a user with the `approve` permission approves it; a rejection SHALL be recorded with a reason.
8. THE System SHALL allow a user with the `configuration` permission to add, rename, recolour and reorder Workflow_States and to edit transitions, and SHALL record an Audit_Event for every such change.
9. THE System SHALL derive each Order's payment status (`Unpaid`, `Deposit paid`, `Partially paid`, `Paid`, `Overpaid`, `Refunded`) from its confirmed Payments; the labels SHALL be configurable through terminology, and the derivation logic SHALL NOT be configurable.
10. WHEN any record changes state, THE System SHALL write a status history entry containing the previous state, new state, acting user, timestamp and optional note.

---

### Requirement 28: Terminology, Units and Unit Conversion

**User Story:** As a business owner, I want the system to use my industry's words and units, so that staff see "Patient" or "Guest" instead of "Customer" and can sell in the units we actually use.

#### Acceptance Criteria

1. THE System SHALL keep a per-Workspace terminology map for at least these terms, in singular and plural: Customer, Lead, Order, Quotation, Product, Variant, Salesperson, Supplier, Purchase Order, Location and Production Job.
2. THE System SHALL apply the terminology map to navigation, page headings, buttons, form labels, generated documents and message template variables.
3. WHEN an Industry Profile is applied, THE System SHALL set the terminology defaults for that industry, and the business SHALL be able to edit them afterwards.
4. THE System SHALL maintain Units, each with name, symbol, dimension (`count`, `weight`, `length`, `area`, `volume`, `time`) and a conversion factor to the base unit of its dimension.
5. EACH Product SHALL have a base unit, and MAY have a sale unit and a purchase unit with a conversion factor to the base unit; stock SHALL always be stored in the base unit.
6. WHEN a quantity is entered in a sale unit or purchase unit, THE System SHALL convert it to the base unit before recording any Stock_Movement.
7. A `measurement` field SHALL store both value and unit, and THE System SHALL allow an `area` measurement to be entered directly; automatic calculation of area from length and width is not required.

---

### Requirement 29: Document Templates, Invoices and Order Confirmations

**User Story:** As a business owner, I want quotations, order confirmations, invoices and receipts produced from templates carrying my branding, so that every customer document is consistent and correct.

#### Acceptance Criteria

1. THE Document_Service SHALL generate these document types: Quotation, Order Confirmation, Invoice, Receipt, Refund Receipt (credit note) and Purchase Order.
2. EACH document type SHALL be rendered from a template with these configurable parts: logo, business details block, header text, footer text, terms text, visible columns, bank details block (on or off) and paper size (A4 for all; additionally 80mm and 58mm for receipts).
3. THE System SHALL generate an Invoice for an Order on demand, and automatically when the Order reaches a configured System_Role (default: `DELIVERED`).
4. EACH Invoice SHALL contain: sequential invoice number, issue date, customer details, line items with custom field snapshot, discounts, tax breakdown, total, payments received, balance due and the configured bank details block.
5. WHEN a document is issued, THE System SHALL store an immutable data snapshot, so that regenerating its PDF always produces the same content.
6. AN issued Invoice SHALL NOT be edited; corrections SHALL be made by issuing a Refund Receipt (credit note) or a new Invoice.
7. THE Document_Service SHALL apply the Workspace terminology and locale formatting (currency, date, number) to every document.
8. WHEN a Receipt is reprinted, THE System SHALL mark the copy as a reprint and record an Audit_Event.

---

### Requirement 30: Tasks, Follow-ups, Notes and Call Logs

**User Story:** As a salesperson, I want tasks, reminders and notes attached to customers, leads and orders, so that I never miss a follow-up and my colleagues can see what happened.

#### Acceptance Criteria

1. THE Task_Service SHALL store Tasks with: type (`call`, `follow_up`, `meeting`, `reminder`, `todo`), title, description, due date and time, assignee, linked entity (Customer, Lead, Order, Quotation or Conversation), status (`open`, `done`, `cancelled`) and creator.
2. THE System SHALL allow internal Notes on Customers, Leads and Orders, including a call-log note type with call direction and outcome; Notes SHALL never be visible to customers.
3. THE System SHALL provide a "My tasks" view showing overdue, due today and upcoming Tasks, filterable by type and linked entity.
4. WHEN a Task becomes due, THE System SHALL create a Notification for its assignee.
5. WHEN a Lead's next action and follow-up date are set, THE System SHALL create or update a linked `follow_up` Task for the assigned salesperson.
6. WHEN a Task is completed, THE System SHALL record the completing user and time, and SHALL add an entry to the linked record's timeline.
7. THE System SHALL show Tasks, Notes and call logs in the timeline of the linked Customer, Lead or Order.

---

### Requirement 31: Global Search

**User Story:** As any staff member, I want one search box that finds customers, orders and products, so that I can get to a record without knowing which screen it lives on.

#### Acceptance Criteria

1. THE System SHALL provide a global search that matches: Customers (name, phone, email), Leads (name, phone, interest), Orders (order number, customer name), Quotations (number), Products (name, SKU, barcode, alias), Suppliers (name) and Conversations (contact name, phone).
2. THE System SHALL return results grouped by entity type, with at most 5 results per type and a link to each record.
3. THE System SHALL return only entity types for which the user holds the `view` permission, and only records in the user's Workspace.
4. THE System SHALL match partial, case-insensitive text, and SHALL match phone numbers regardless of spaces, dashes or country-code formatting.
5. THE System SHALL return search results within 500ms at the 95th percentile for a Workspace holding 100,000 records.

---

### Requirement 32: Data Import and Export

**User Story:** As a business owner, I want to load my existing products and customers from a spreadsheet and export my lists, so that I can start quickly and keep my own copies.

#### Acceptance Criteria

1. THE System SHALL support CSV import for: Products with Variants, Customers, Suppliers and opening stock.
2. THE import flow SHALL be: upload file, map columns, validate, show a preview with row-level errors, then commit.
3. THE System SHALL, by default, commit an import only if every row is valid, and SHALL offer an option to skip invalid rows.
4. THE System SHALL run imports as background jobs with visible progress, SHALL store an Import_Job record (file, user, counts, errors) and SHALL record an Audit_Event.
5. WHEN an imported Customer matches an existing one by normalized phone or email, or an imported Product matches by SKU, THE System SHALL skip or update the existing record according to the user's choice for that import.
6. THE System SHALL provide a downloadable CSV template per import type that includes the Workspace's active custom fields.
7. THE System SHALL allow a user with the `export` permission to export the Customer, Lead, Product, Order, Payment and stock lists as CSV, and SHALL record an Audit_Event for each export.

---

### Requirement 33: Notifications

**User Story:** As a staff member, I want to be told when something needs my attention, so that I do not have to keep checking every screen.

#### Acceptance Criteria

1. THE System SHALL provide in-app Notifications with an unread count, a list, and actions to mark one or all as read.
2. THE System SHALL create Notifications for these events: Lead assigned, inbound message on an assigned Conversation, Task due or overdue, low stock, payment due, Order status changed, Approval_Request created or decided, integration failure, AI escalation and import finished.
3. THE System SHALL send each Notification to the assigned user when the record has one, and otherwise to all users whose Roles hold the permission relevant to that event.
4. EACH Notification SHALL link to the record it concerns.
5. THE System SHALL let each user set, per notification type, whether to receive it in-app and by email, with defaults defined per Role.
6. WHERE an email provider is configured, THE System SHALL deliver email notifications through the Email_Adapter; WHERE none is configured, in-app delivery SHALL continue to work.
7. Customer-facing notifications (order status, payment reminder) SHALL be sent only through Automation_Rules (Requirement 17), using approved templates and respecting consent (Requirement 42).

---

### Requirement 34: File and Media Storage

**User Story:** As a staff member, I want to attach product photos, reference images and payment proofs to records, so that everything about a job is in one place and stays private.

#### Acceptance Criteria

1. THE System SHALL store files through a Storage_Adapter with a local-disk driver for development and an S3-compatible driver for testing and production.
2. THE System SHALL accept only allow-listed file types (JPEG, PNG, WebP and PDF; additionally CSV for imports) and SHALL verify the type from the file content, not only from its extension.
3. THE System SHALL reject files larger than a configurable limit (default 10 MB) with HTTP 413.
4. THE System SHALL keep all files private and SHALL serve them only through short-lived signed URLs issued after a permission and tenant check.
5. EACH stored file SHALL have a File_Asset record containing: Workspace, storage key, original name, MIME type, size, uploader and linked entity.
6. THE System SHALL allow files to be attached to: Products (images), Quotations, Orders and their lines (reference images and attachments), Expenses, Payments (proof), Messages (media) and Customers.
7. THE System SHALL generate a thumbnail (longest side 400 pixels) for every uploaded image.
8. THE System SHALL prevent deletion of a file that is referenced by an issued document or a Message.

---

### Requirement 35: Pricing, Discounts and Tax

**User Story:** As a business owner, I want prices, discounts and tax calculated the same way everywhere, so that a quotation, an order, a POS sale and an invoice never disagree.

#### Acceptance Criteria

1. THE System SHALL resolve a line's unit price in this order: the Customer's assigned Price_List, the Workspace's active default Price_List, the Variant price override, the Product base price.
2. WHERE price lists are enabled, THE System SHALL support Price_Lists with name, validity dates and per-Variant prices, and SHALL allow one Price_List to be assigned to a Customer.
3. THE System SHALL support a discount per line and a discount per order, each as an amount or a percentage, and SHALL never allow a line total or order total below zero.
4. EACH Role SHALL have a maximum discount percentage; WHEN a user exceeds it, THE System SHALL either reject the discount or create an Approval_Request, according to Workspace configuration.
5. WHERE tax is enabled, THE System SHALL support Tax Classes with a rate, a Workspace setting for tax-inclusive or tax-exclusive prices, per-line tax calculation, and a tax breakdown per rate on documents.
6. THE System SHALL calculate with decimal arithmetic, round half-up to the currency's configured decimal places at line-total level, and compute the order total as the sum of rounded line totals.
7. WHERE cash rounding is configured, THE POS_Service SHALL round the cash amount payable to the configured increment and record the rounding difference.
8. THE System SHALL support exactly one currency per Workspace; multi-currency is out of scope.
9. WHEN a user manually overrides a unit price, THE System SHALL require the price-override permission and SHALL record an Audit_Event with the original and new price.
10. THE System SHALL use one shared calculation implementation for Quotations, Orders, POS sales and Invoices, and SHALL store the calculated totals on each record.

---

### Requirement 36: Catalog Extensions

**User Story:** As a catalog manager, I want brands, units, barcodes, stock limits and alternative names on products, so that staff, scanners and the AI assistant can all find the right item.

#### Acceptance Criteria

1. EACH Product SHALL additionally support: internal code, Brand, base unit, tags, and a made-to-order flag; EACH Variant SHALL additionally support: barcode, minimum stock level and maximum stock level.
2. THE Catalog_Service SHALL provide create, edit and archive for Brands.
3. THE Catalog_Service SHALL enforce that a barcode is unique within a Workspace and SHALL provide a lookup that returns the Variant for a scanned barcode.
4. EACH Product SHALL support a list of aliases (alternative names and keywords, in any language) used by global search and by AI product matching.
5. EACH Product SHALL have visibility flags for the messaging and AI channel and for POS; THE AI_Service SHALL NOT propose a Product that is hidden from the messaging and AI channel.
6. THE System SHALL treat product types as follows: `STOCKABLE` is stock-tracked; `NON_STOCKABLE` and `SERVICE` are never stock-tracked; `BUNDLE` follows Requirement 6.8; a made-to-order Product can be sold with no stock and creates a Production_Job.
7. THE Catalog_Service SHALL generate Variants from the option values of variant-axis fields, creating one Variant per combination with a SKU built from a configurable pattern.
8. WHEN a Product is created without Variants, THE System SHALL create one default Variant, so that price, barcode and stock always attach to a Variant.

---

### Requirement 37: Stock Operations and Valuation

**User Story:** As a warehouse manager, I want opening stock, reasoned adjustments, stock counts and a stock value, so that the numbers in the system match the shelves and the accounts.

#### Acceptance Criteria

1. THE Inventory_Service SHALL allow opening stock to be entered per Variant and Inventory_Location with a unit cost, recorded as an `OPENING_STOCK` Stock_Movement.
2. EVERY stock adjustment SHALL require a reason chosen from a configurable list (default: damage, loss, found, correction, sample, internal use) and SHALL accept a note.
3. WHEN the value of an adjustment exceeds a configurable threshold, THE System SHALL require approval before posting it.
4. THE Inventory_Service SHALL support a stock count: create a count for a location, enter counted quantities, review the proposed differences, and post them as adjustment Stock_Movements.
5. WHERE negative stock is not allowed (the default), THE Inventory_Service SHALL reject any operation that would make available stock negative, with HTTP 409 and the available quantity.
6. WHEN two operations attempt to take the same last unit of stock at the same time, THE System SHALL allow exactly one to succeed.
7. THE Inventory_Service SHALL value stock by weighted average cost per Variant, updated on every purchase receipt and opening stock entry; first-in-first-out valuation is not required.
8. WHEN stock is sold, THE System SHALL store the Variant's average cost at that moment on the sale line for cost-of-goods-sold reporting.
9. THE Inventory_Service SHALL maintain a Stock_Level per Variant and location with on-hand, reserved and available quantities, which SHALL always equal the values computed from the Stock_Movement ledger and active reservations.
10. THE System SHALL provide a Stock_Movement list filterable by Variant, location, movement type, date range, reference and user.
11. WHEN on-hand stock exceeds a Variant's maximum stock level, THE System SHALL flag it as overstock in the inventory report.

---

### Requirement 38: Returns, Refunds and Supplier Returns

**User Story:** As a manager, I want returns and refunds handled as traceable reversals, so that stock, money, commissions and reports all stay correct when a sale is undone.

#### Acceptance Criteria

1. THE System SHALL allow a customer return against an Order or POS sale by selecting lines and quantities, where each quantity SHALL NOT exceed the quantity sold minus the quantity already returned.
2. EACH return SHALL record a reason and, per line, whether the goods are restocked.
3. WHEN returned goods are restocked, THE System SHALL create `RETURN_IN` Stock_Movements; WHEN they are not restocked, THE System SHALL create no stock increase and SHALL record the reason.
4. THE System SHALL calculate the refundable amount for a return in proportion to the returned quantity, including the line's share of discounts and tax.
5. THE System SHALL require the `refund` permission to issue a refund, SHALL record it as a Payment of type `REFUND` through a chosen payment method or as Customer credit, and SHALL generate a Refund Receipt.
6. THE System SHALL prevent the total refunded for an Order from exceeding the total confirmed payments for that Order.
7. WHEN an Order with confirmed payments is cancelled, THE System SHALL require a decision to refund the payments or convert them to Customer credit.
8. THE System SHALL allow a return to a Supplier against a received Purchase_Order, where each quantity SHALL NOT exceed the quantity received minus the quantity already returned, creating `RETURN_TO_SUPPLIER` Stock_Movements and reducing the amount payable to that Supplier.
9. THE System SHALL report returns as negative sales in the period in which the return occurred.

---

### Requirement 39: Custom Orders, Production and Fulfilment

**User Story:** As a furniture business, I want to take an order for a custom piece with measurements, material, colour and a reference picture, and follow it through production to delivery and final payment.

#### Acceptance Criteria

1. AN Order line SHALL be either a catalog line (a Variant) or a custom line; a custom line SHALL be based on a made-to-order Product or be a free-text item with name, description and price.
2. A custom line SHALL carry the configured custom field values (for the furniture profile: custom size, length, width, height, area, material, colour, design, customization notes, estimated production requirement), reference images and other attachments.
3. EACH Order SHALL record an order type (default list: `STANDARD`, `CUSTOM`, `POS`) and a sales source (`POS`, `MESSAGING`, `SOCIAL`, `STORE`, `WEBSITE`, `MANUAL`).
4. WHEN a customer approves a Quotation, THE System SHALL record who recorded the approval, when, by which means (in person, message, phone) and an optional attachment.
5. WHERE a required deposit percentage is configured for the Workspace or order type, THE System SHALL prevent an Order from entering the `IN_PRODUCTION` System_Role until confirmed payments reach that percentage, unless the user holds the override permission.
6. WHEN an Order enters the `IN_PRODUCTION` System_Role, THE System SHALL create a Production_Job for each custom line, with status (default Production workflow: Queued, In progress, Quality check, Done), assigned production staff, due date and notes.
7. THE System SHALL show a production user only the Production_Jobs assigned to them, with the line's specifications and attachments, and without prices unless the user holds `financial_access`.
8. WHEN every Production_Job of an Order is done, THE System SHALL allow the Order to move to the `READY` System_Role, and SHALL move it automatically where so configured.
9. EACH Order SHALL record fulfilment details: method (pickup or delivery), address, scheduled date, delivered date, delivered by, receiver name and an optional proof attachment.
10. THE System SHALL prevent an Order from entering the `COMPLETED` System_Role while its balance due is greater than zero, unless the user holds the override permission, and SHALL record the closing time.

---

### Requirement 40: Bank Accounts, Payment Methods and Payment Verification

**User Story:** As a business owner, I want my accounts and payment methods set up once, and a payment counted only when my staff confirm it, so that a customer saying "I paid" never becomes money in my books by itself.

#### Acceptance Criteria

1. THE System SHALL maintain Financial_Accounts of type cash, bank, mobile wallet or card terminal; a bank account SHALL additionally hold bank name, account title, account number or IBAN, and branch.
2. EACH Financial_Account SHALL have a customer-facing flag; only customer-facing accounts SHALL appear on documents and in bank-details messages, and THE System SHALL store no other bank data.
3. THE System SHALL maintain a configurable list of payment methods, each with name, type, linked Financial_Account, active flag and whether a reference number is required.
4. EACH Payment SHALL record its payment method and the Financial_Account it was received into or paid from.
5. EACH Payment SHALL have a status: `PENDING_VERIFICATION`, `CONFIRMED`, `REJECTED` or `VOIDED`; only `CONFIRMED` Payments SHALL affect balances, reports and commissions.
6. A customer message or an AI output SHALL never create a `CONFIRMED` Payment; it MAY create a `PENDING_VERIFICATION` Payment with the proof attached, which a user with `financial_access` confirms or rejects.
7. A `CONFIRMED` Payment SHALL NOT be edited; a correction SHALL be made by voiding it with a reason (requiring `financial_access`) and recording a new Payment, with an Audit_Event holding the old and new values.
8. THE System SHALL hold Customer credit arising from overpayments and refunds-to-credit, and SHALL allow it to be applied to an Order.
9. THE System SHALL provide a payment timeline per Customer and per Order.
10. THE System SHALL provide an account report showing money in, money out and net movement per Financial_Account for a date range.
11. THE System SHALL provide a bank-details message template whose variables resolve from the customer-facing accounts.

---

### Requirement 41: Staff Profiles, Sales Attribution and Performance

**User Story:** As a sales manager, I want each staff member's profile, commission terms and results in one place, so that sales are credited to the right people and paid correctly.

#### Acceptance Criteria

1. EACH staff member SHALL have a profile within the Workspace containing: name, phone, job title, employee code, join date, active flag, default Inventory_Location, a salesperson flag and individual commission settings.
2. THE System SHALL record the assigned salesperson on Leads, Customers, Quotations, Orders and POS sales, and SHALL record an Audit_Event when the assignment changes.
3. AN Order SHALL support more than one salesperson, each with a share percentage; the shares SHALL total 100, and the default SHALL be one salesperson with 100.
4. THE Commission_Service SHALL support rules scoped additionally by salesperson and by order type, and SHALL select the rule for a line in this order: salesperson-specific rules before general rules; then Product scope, Category scope, order-type scope, all-products scope; then the highest priority value; then the most recently created.
5. EACH commission rule SHALL define its commission base: net sales (after discounts, before tax), gross sales (before discounts) or gross profit (net sales minus cost).
6. THE System SHALL provide a performance view per salesperson for a date range showing: Leads assigned, Leads won, conversion rate, sales value, average order value, and commissions pending, approved and paid.
7. A salesperson SHALL see only their own performance and commissions, unless they hold the permission to view all staff.
8. WHEN part of an Order is returned, THE Commission_Service SHALL reverse the commission in proportion to the returned value.

---

### Requirement 42: Messaging Rules, Delivery Status, Media and Social Leads

**User Story:** As a business owner, I want messaging to follow the provider's rules and my customers' consent, and every message, attachment and lead to be linked correctly even when events arrive late or twice.

#### Acceptance Criteria

1. EACH outbound Message SHALL have a delivery status (`queued`, `sent`, `delivered`, `read`, `failed`) updated from provider callbacks; the status SHALL only move forward, and a failure reason SHALL be stored.
2. THE System SHALL order Messages by the provider's timestamp, and a late-arriving earlier event SHALL neither create a duplicate nor move a status backwards.
3. THE System SHALL download inbound media and store it through the Storage_Adapter, supporting text, image, document, audio, video and location messages; an unsupported type SHALL be stored as a placeholder naming the type.
4. THE Channel_Adapter SHALL report whether free-form messages are currently allowed for a Conversation under the provider's rules; WHEN they are not, THE System SHALL allow only provider-approved templates to be sent.
5. THE System SHALL store, for each provider template, its provider name, language and approval status, and SHALL allow only approved templates to be sent outside the provider's free-form window.
6. THE System SHALL record consent per contact and channel (status and source), SHALL treat configurable opt-out keywords (default: STOP, UNSUBSCRIBE) as an opt-out, and SHALL send no automated or template message to an opted-out contact.
7. THE System SHALL allow automation to be switched off at four scopes: the whole platform, a Workspace, a Conversation, and by rule (outside configured business hours, or per channel).
8. WHEN a social lead form is submitted, THE System SHALL create a Lead containing the source, channel, campaign, advertisement and form identifiers and every submitted field, mapped to Lead fields or stored as custom fields.
9. THE System SHALL keep the source and channel attribution of a Lead when it converts to a Customer, Quotation or Order, so that sales can be reported by source.
10. THE System SHALL allow staff to send product images and Quotation, Invoice and Receipt PDFs as attachments where the channel permits.
11. EACH Conversation SHALL have an assigned staff member, an unread count and a status (`open`, `pending`, `closed`); an inbound message on a closed Conversation SHALL reopen it.
12. THE System SHALL show integration error details only to users with `integration_access`, SHALL show other users a generic failure message, and SHALL never return stored credentials through any API (masked values only).
13. WHEN an inbound sender cannot be matched, THE System SHALL create a new Lead; a user SHALL be able to link that Conversation to an existing Customer later.

---

### Requirement 43: AI Behaviour, Grounding and Operating Modes

**User Story:** As a business owner, I want the AI assistant to read chats, fill in what the customer wants and draft replies using only my real data, so that it saves my staff time without ever inventing a price, a stock level or a payment.

#### Acceptance Criteria

1. THE AI_Service SHALL provide these functions: summarize a Conversation; extract requirements (products, quantities, dimensions, colours, materials, designs, budget and the configured custom fields); match products; classify the Lead (intent and priority); draft a reply; choose the next missing question; suggest a next action and follow-up date; and generate an internal note.
2. THE extraction result SHALL list the required configured fields that were not found, as missing fields.
3. THE System SHALL hold, per Industry Profile and optionally per Category, an editable question flow: an ordered list of fields to ask for, each with a question template; THE AI_Service SHALL choose the next question from the first missing field in that flow.
4. THE AI_Service SHALL match products only against the Workspace's own catalog of AI-visible Products, SHALL return candidates with a score, and SHALL report "no match" instead of inventing a product.
5. THE AI_Service SHALL build each draft from a context pack containing only data read from the database and approved Knowledge_Items, and a draft SHALL state a price, availability, policy, bank detail or payment status only if that value is in the context pack.
6. THE System SHALL run a deterministic validator on every draft that checks each monetary amount and each availability statement against the context pack; a draft that fails SHALL be flagged and SHALL NOT be sent automatically.
7. THE System SHALL let the business maintain Knowledge_Items (approved question-and-answer or policy texts), and only active Knowledge_Items SHALL be given to the AI.
8. THE System SHALL let the business configure the AI's tone, reply language (match the customer, or fixed) and maximum reply length.
9. THE System SHALL support three AI modes per Workspace: `OFF`; `ASSIST` (the AI prepares suggestions and drafts, and a staff member sends); and `AUTO_REPLY` (the AI sends replies only for message categories the business has enabled, only when the validator passes, and never for discounts, prices absent from the catalog, payment confirmations, refunds or delivery promises).
10. THE System SHALL store every AI output as an AI_Suggestion with status `pending`, `approved`, `edited` or `rejected`; data SHALL be written to a Lead or Customer only when a user approves, and the written values SHALL record the AI as source and the approving user.
11. WHEN any of these occurs, THE System SHALL flag the Conversation for a human and create a Notification: low confidence, an escalation keyword, the customer asking for a person, a complaint, or repeated AI failure.
12. THE AI_Service SHALL send the provider only the data needed: the most recent messages of the Conversation (configurable count, default 30), and the relevant business and product context; it SHALL NOT send credentials, non-customer-facing bank data, other customers' data or staff personal data, and SHALL NOT send attachments unless image understanding is explicitly enabled.
13. THE System SHALL enforce a daily request limit and a monthly usage budget per Workspace; WHEN a limit is reached, THE System SHALL stop making AI calls, show a clear indicator and report usage.
14. WHEN the AI provider fails or times out, THE System SHALL produce no suggestion, flag the Conversation for a human, log the failure and leave all other functions working.
15. THE System SHALL set a field's confidence to low when the value is not explicitly present in the conversation text, regardless of the confidence reported by the model.
16. THE project SHALL include an evaluation set of at least 20 representative conversations with expected extraction results, run as an automated test with a configurable pass threshold (default 85% of fields correct).

---

### Requirement 44: Additional Reports and Daily Closing

**User Story:** As a business owner, I want every report named in the specification, so that I can see sources, balances, stock value, staff results and system activity without asking a developer.

#### Acceptance Criteria

1. In addition to Requirement 19.2, THE Reporting_Service SHALL provide: Lead Source Performance (leads, won, conversion rate and revenue by source, channel and campaign), Orders by Status, Top Customers, Outstanding Customer Balances with ageing (0-30, 31-60, 61-90, over 90 days), Supplier Balances, Purchases, Expenses by Category, Stock Valuation, Stock Movements, Low Stock, Salesperson Performance, Sales History, Returns, POS Daily Closing, Account Movements, AI and Automation Activity, Channel Message Volume and User Activity.
2. EACH report SHALL define its filters (date range and, where relevant, location, salesperson, Category, source), its columns, its totals and the record list that a total drills down to.
3. THE POS Daily Closing report SHALL show, per POS_Session and per day: number of sales, gross sales, discounts, tax, returns, net sales, totals per payment method, and expected against counted cash.
4. THE Reporting_Service SHALL calculate all date boundaries in the Workspace's timezone.
5. AN Industry Profile SHALL be able to define the set of dashboard indicators shown for that industry.
6. THE custom report builder SHALL let an authorized administrator choose a dataset (sales lines, orders, payments, leads, stock movements, expenses), dimensions, measures and filters, save the report and share it with Roles; it SHALL respect all permissions and SHALL NOT accept database queries written by the user.

---

### Requirement 45: Account Security and Sessions

**User Story:** As a business owner, I want staff accounts protected by sensible password, lockout and session rules, so that a lost password or a departed employee does not expose my business.

#### Acceptance Criteria

1. THE Auth_Service SHALL require passwords of at least 10 characters that differ from the user's email, and SHALL store them only as an adaptive one-way hash.
2. THE Auth_Service SHALL provide password reset through a single-use token valid for 60 minutes, and SHALL give the same response whether or not the account exists.
3. WHERE no email provider is configured, a user with the `configuration` permission SHALL be able to generate a one-time reset link for another user.
4. WHEN five login attempts fail for an account within 15 minutes, THE Auth_Service SHALL lock that account for 15 minutes and record an Audit_Event.
5. THE System SHALL let a user see and revoke their active sessions, and SHALL revoke all other sessions when the password is changed.
6. A user who belongs to more than one Workspace SHALL choose a Workspace at login and SHALL be able to switch; each access token SHALL be valid for exactly one Workspace.
7. WHEN a user's Roles or a Role's permissions change, THE System SHALL apply the change to that user's requests within 60 seconds without requiring a new login.
8. THE System SHALL record an Audit_Event for every successful and failed login, with IP address and user agent.
9. Two-factor authentication is not required in this version.

---

### Requirement 46: Platform Administration and Onboarding

**User Story:** As the platform operator, I want to create, suspend and reactivate business workspaces, so that the system can be run as a service for many businesses.

#### Acceptance Criteria

1. THE System SHALL support a Platform_Admin who can list, create, suspend and reactivate Workspaces.
2. A Platform_Admin SHALL NOT be able to read a Workspace's business data through the application, unless an Owner of that Workspace grants time-limited support access, which SHALL be recorded as an Audit_Event.
3. WHILE a Workspace is suspended, THE System SHALL block its logins, SHALL acknowledge and store its inbound webhooks without processing them, and SHALL pause its scheduled jobs.
4. THE System SHALL control public self-registration of new Workspaces with a platform setting that is off by default.
5. THE System SHALL guide a new Owner through onboarding: business details, Industry Profile, currency and timezone, first Inventory_Location, and inviting staff.
6. WHEN a Workspace is deleted, THE System SHALL mark it deleted, retain its data for a configurable period (default 30 days) and then purge it.

---

### Requirement 47: Privacy, Retention and Data Requests

**User Story:** As a business owner, I want to export or erase a customer's personal data and control how long conversations are kept, so that I can meet my privacy obligations.

#### Acceptance Criteria

1. THE System SHALL export all data held about one Customer (profile, conversations, orders, payments) as a file, on request by a user with the `export` permission.
2. THE System SHALL anonymize a Customer on request by a user with the `configuration` permission: personal fields and message bodies are replaced, financial records are kept, the action is irreversible and an Audit_Event is recorded.
3. THE System SHALL provide retention settings per Workspace for messages and media and for AI logs, and a scheduled job that purges data older than the configured period.
4. THE System SHALL retain Audit_Events for at least 24 months, and a tenant SHALL NOT be able to delete them.
5. THE project SHALL maintain an AI data-handling document stating exactly which data is sent to the AI provider, and THE System SHALL show a summary of it on the AI settings screen.
6. THE System SHALL allow an Owner to request an export of the whole Workspace's data, produced as a background job.

---

### Requirement 48: Integration Contract and Additional Adapters

**User Story:** As a platform developer, I want every integration to meet the same documented contract, so that failures, retries and credential changes behave predictably for every provider.

#### Acceptance Criteria

1. EVERY integration SHALL implement and document: authentication method and encrypted secret storage, webhook or event ingestion, retry policy, idempotency key, rate-limit handling, timeouts, error mapping to normalized error codes, structured logging, health status, disconnect and reconnect behaviour, data synchronization rules and a manual resynchronization action.
2. THE System SHALL define adapter interfaces for these categories: Channel, AI, Email, Storage, Print Output and Payment Provider.
3. THE Email_Adapter SHALL have an SMTP driver and SHALL be used for invitations, password resets and email notifications.
4. THE Payment_Provider adapter interface SHALL be defined; no payment provider SHALL be implemented until one is selected, and the feature SHALL be switched off by default.
5. THE Print Output adapter SHALL have a PDF driver; a plain-text thermal (ESC/POS) driver MAY be added later without changing callers.
6. THE System SHALL encrypt stored integration secrets with authenticated encryption using a key held only in environment configuration, and SHALL return only masked values when reading them.
7. THE System SHALL respect provider rate limits by honouring retry-after responses and throttling its outbound queue.
8. THE System SHALL apply a timeout to every outbound provider call (default 10 seconds; 30 seconds for AI).
9. THE integration settings page SHALL show, per integration: status, last success, last error and pending queue size, with "test connection" and "resynchronize" actions.
10. WHEN an integration is disconnected, THE System SHALL stop processing for it and keep its history; WHEN it is reconnected, processing SHALL resume without creating duplicates.
11. THE System SHALL allow a credential to be replaced without downtime, and the rotation procedure SHALL be documented.
12. THE API SHALL be versioned under `/api/v1` and SHALL publish a generated OpenAPI description; third-party API keys are reserved for a future version.

---

### Requirement 49: Web Application Structure and User Experience

**User Story:** As a staff member, I want one coherent application with navigation that matches my role, so that I can do my job on a desktop or a phone without training on each screen separately.

#### Acceptance Criteria

1. THE web application SHALL provide these primary areas and screens: Home (indicators, alerts, my tasks); CRM (customers, leads, pipeline, conversations, tasks); Sales (quotations, orders, sales history, returns); POS (checkout, sessions, receipts, returns); Products (catalog, categories, variants, attributes, pricing); Inventory (stock, movements, locations, alerts); Purchasing (suppliers, purchase orders, receipts, payments); Finance (payments, expenses, balances, reports); Staff (users, roles, commissions, performance); Automation (AI, rules, templates, quick replies); Integrations (connected channels, status, logs); Reports; and Settings (business profile, industry, fields, workflows, permissions).
2. THE web application SHALL hide navigation items and actions for which the user lacks permission; the API SHALL still enforce every permission.
3. THE web application SHALL be usable at a width of 360 pixels for CRM, conversations, orders and tasks, at 768 pixels and above for POS, and SHALL be optimized for 1280 pixels and above.
4. EVERY list screen SHALL provide search, filters, sorting, pagination, a loading state, an empty state and an error state with retry.
5. EVERY form SHALL provide inline validation, display server validation errors against the relevant fields, warn before discarding unsaved changes, and disable its submit control while a request is pending.
6. THE web application SHALL apply the Workspace terminology, currency, date and number formats and timezone on every screen.
7. THE web application SHALL route all user-visible text through a translation layer, with English at launch; right-to-left layout SHALL be supported when a right-to-left locale is added.
8. THE core flows (login, lead, quotation, order, payment, POS checkout) SHALL be fully operable by keyboard and SHALL have labelled form controls.
9. THE POS screen SHALL accept input from barcode scanners that act as keyboards.
10. WHEN a session expires, THE web application SHALL redirect to login and return the user to the same page after signing in.
11. THE web application SHALL render custom fields on every entity form with one shared component driven by Field_Definitions.
12. THE web application SHALL keep authentication tokens only in HTTP-only cookies and SHALL store no business data in browser local storage.

---

### Requirement 50: System Defaults, Seed and Sample Data

**User Story:** As a developer and as a new business owner, I want every workspace to start with working defaults and a realistic demo dataset, so that every module can be tested from the first day.

#### Acceptance Criteria

1. WHEN a Workspace is created, THE System SHALL create its default data: system Roles, Workflows, the Industry Profile's Field_Definitions and terminology, lost reasons, adjustment reasons, expense categories, payment methods, one cash Financial_Account, Units, document templates and numbering sequences.
2. THE project SHALL include a seed command that creates a demo Workspace on the furniture profile containing at least: 6 Categories, 30 Products with Variants and images, 1 Inventory_Location with opening stock, 20 Customers, 15 Leads spread across stages, 10 Quotations, 15 Orders spread across statuses with Payments, 5 Suppliers, 5 purchases, 10 Expenses, one staff user per default Role with commission settings, 10 sample Conversations, 5 Knowledge_Items and 5 message templates.
3. THE seed command SHALL be safe to run repeatedly and SHALL refuse to run against a production environment unless an explicit override flag is given.
4. THE project SHALL include a command that resets the demo Workspace to its seeded state.
5. All sample data SHALL be synthetic and SHALL NOT contain any real person's details.
6. THE project SHALL include a command that removes demo business records from a Workspace while keeping its configuration, for use at go-live.

---

### Requirement 51: Monitoring, Logging and Health

**User Story:** As the operator, I want health checks, structured logs and alerts, so that I learn about a failure before the client does.

#### Acceptance Criteria

1. THE API SHALL expose a liveness endpoint and a readiness endpoint; readiness SHALL check the database, the queue store and file storage.
2. THE System SHALL write structured logs containing request identifier, Workspace and user, and SHALL redact secrets and personal data fields.
3. THE System SHALL support sending unhandled errors to an error-tracking service when one is configured.
4. THE System SHALL record these measures: request rate, latency and error rate; queue depth and failed jobs; webhook processing success rate; and AI call count and failures.
5. THE operations documentation SHALL define alerts for: API unavailable, elevated error rate, queue backlog, failed backup, integration failure and storage above 80% of capacity.
6. THE System SHALL provide an Owner-only system status page showing integration health, queue status and the time of the last successful backup.

---

### Requirement 52: Environments, Deployment and Handover

**User Story:** As the client, I want the system tested on a test environment, then deployed to my own server with documentation, so that I own and can operate what I paid for.

#### Acceptance Criteria

1. THE project SHALL define three environments: development (local containers), testing (a hosted platform: web service, API service, PostgreSQL, key-value store, S3-compatible storage) and production (the client's virtual private server running containers behind a reverse proxy with TLS).
2. THE System SHALL read all configuration from environment variables validated at startup, and SHALL refuse to start when a required value is missing or invalid.
3. THE deployment process SHALL be scripted and documented, and SHALL run database migrations as a release step before new code serves traffic.
4. THE project SHALL document a rollback procedure (previous release plus the migration's rollback script) and SHALL rehearse it once before production go-live.
5. THE production environment SHALL take automated daily backups, keep an off-server copy and retain them for at least 14 days; a restore SHALL be tested and the test date recorded.
6. THE handover package SHALL contain: source code, environment configuration documentation, database schema documentation, API documentation, deployment instructions, administrator guide, user guide, test report, known limitations and recovery procedures.
7. Production deployment SHALL take place only after the client signs off testing on the testing environment.
8. THE repository SHALL contain no secrets, and the credential rotation procedure SHALL be documented.

---

### Requirement 53: Testing and Acceptance

**User Story:** As the client, I want each module proven by business-process tests and not only by screens existing, so that I can rely on the numbers.

#### Acceptance Criteria

1. THE project SHALL include: unit tests for business rules, integration tests for external channel adapters, workflow end-to-end tests, permission tests, tenant-isolation tests, AI extraction tests, load tests and user acceptance tests with the first business.
2. THE project SHALL automate the four critical workflows of the source specification: (A) new customer from messaging, (B) custom furniture order, (C) walk-in POS sale and (D) lead to sale.
3. THE permission test SHALL exercise every API endpoint with every default Role and assert the expected allow or deny.
4. THE tenant-isolation test SHALL cover every tenant-scoped model and every list and detail endpoint.
5. THE reconciliation test SHALL assert, on the seeded dataset, that every report total equals the sum of its source transactions.
6. EACH correctness property in the design SHALL have a property-based test running at least 100 cases.
7. Tests covering money, stock, permissions and tenant isolation SHALL be mandatory for a task to be considered complete; they SHALL NOT be optional.
8. THE continuous-integration pipeline SHALL run lint, type checking, unit tests and integration tests on every push, and a failure SHALL block deployment.
9. THE client SHALL sign a user-acceptance checklist covering the fifteen areas of the source specification's acceptance table: tenant isolation, permissions, CRM, messaging, AI, products, inventory, orders, POS, finance, reports, printing, integrations, audit and backup.

---

### Requirement 54: Idempotency, Concurrency and Numeric Precision

**User Story:** As a business owner, I want a double-click, a retried request or two cashiers working at once never to create a duplicate sale or a wrong balance.

#### Acceptance Criteria

1. THE API SHALL accept an idempotency key on every request that creates a financial or stock record (POS checkout, Payment, refund, Order creation, stock movement, purchase receipt); a repeated key within 24 hours SHALL return the original result and create nothing new.
2. THE System SHALL use optimistic concurrency on Orders, Quotations, Products, Customers and Leads: an update carrying a stale version SHALL be rejected with HTTP 409.
3. THE System SHALL store monetary amounts and quantities as fixed-point decimals, SHALL compute them with a decimal library, SHALL never use binary floating point for them, and SHALL transmit them in JSON as strings.
4. THE System SHALL store all timestamps in UTC and display them in the Workspace's timezone.
5. THE System SHALL allocate document numbers inside the same database transaction as the document, so that numbers are unique and gap-free per document type and Workspace.
6. Posted financial and stock records SHALL be immutable; corrections SHALL be made by reversing entries.
7. Master data SHALL be archived instead of deleted; only a draft that has never been referenced MAY be permanently deleted.
8. EVERY business operation that writes more than one record SHALL be atomic.
9. THE System SHALL expose only opaque identifiers and SHALL never expose sequential database identifiers.

---

### Requirement 55: Extensibility and Module Boundaries

**User Story:** As the product owner, I want new modules and new industries to be added without rewriting the core, so that the system can grow into a product for many kinds of business.

#### Acceptance Criteria

1. EACH domain module SHALL expose a service interface; modules SHALL communicate only through those interfaces and Domain_Events, and SHALL NOT read or write another module's tables directly.
2. WHEN a module is switched off for a Workspace, THE System SHALL hide its navigation, reject its endpoints with HTTP 403 and code `MODULE_DISABLED`, and stop its scheduled jobs for that Workspace.
3. Orders, POS_Sessions, Stock_Movements and staff profiles SHALL carry an Inventory_Location, and reports SHALL be filterable by location, so that multi-branch operation can be added later.
4. THE design SHALL document the extension points (Domain_Events, Field_Definitions, Workflows, adapters and the navigation registry) that future modules use; the future modules named in the source specification (delivery routing, repair and service, manufacturing planning, attendance and payroll, loyalty, marketing campaigns, online store synchronization, appointments, advanced procurement, multi-branch, franchise, advanced accounting, mobile applications, forecasting, voice assistance and additional channels) are not part of this version.
5. A new Industry Profile SHALL be addable as data, without code changes.
6. BEFORE final acceptance, at least two non-furniture Industry Profiles SHALL be configured and smoke-tested through product creation, order and POS sale, to prove the core is industry-neutral.

---

### Requirement 56: POS Resilience and Printing Behaviour

**User Story:** As a cashier, I want a clear, safe result when the network or the printer misbehaves, so that I never charge a customer twice or lose a receipt.

#### Acceptance Criteria

1. Offline selling is not supported in this version; WHEN the API cannot be reached, THE POS screen SHALL show a blocking notice, keep the cart on screen and retry, and SHALL record no sale locally.
2. THE POS checkout SHALL send an idempotency key, so that retrying after a timeout cannot create a second sale.
3. THE POS_Service SHALL save the receipt data inside the sale transaction, so that IF document rendering fails after the sale is committed, THEN the sale stands and the receipt can be generated again.
4. THE System SHALL print by opening the generated PDF with the browser's print function; THE System SHALL NOT install, detect or configure printers.
5. Camera-based barcode scanning is not required in this version.
