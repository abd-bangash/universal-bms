-- Finance (task 39): accounts, payment methods, payments, customer credit, receipts, expenses.
-- CreateEnum
CREATE TYPE "payment_type" AS ENUM ('ORDER_PAYMENT', 'DEPOSIT', 'ADVANCE', 'CREDIT_APPLIED', 'REFUND');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('PENDING_VERIFICATION', 'CONFIRMED', 'REJECTED', 'VOIDED');

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bank_name" TEXT,
    "account_title" TEXT,
    "account_number" TEXT,
    "branch" TEXT,
    "show_to_customers" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "requires_reference" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "payment_number" TEXT NOT NULL,
    "type" "payment_type" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'CONFIRMED',
    "order_id" TEXT,
    "customer_id" TEXT,
    "return_id" TEXT,
    "payment_method_id" TEXT,
    "account_id" TEXT,
    "amount" DECIMAL(18,4) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference_number" TEXT,
    "proof_file_id" TEXT,
    "note" TEXT,
    "pos_session_id" TEXT,
    "recorded_by_id" TEXT,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "rejected_reason" TEXT,
    "voided_by_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credits" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "payment_id" TEXT,
    "order_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SALE',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB NOT NULL,
    "reprint_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_categories" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "expense_date" TIMESTAMP(3) NOT NULL,
    "payment_method_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "description" TEXT,
    "attachment_file_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "void_reason" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_workspace_id_name_key" ON "financial_accounts"("workspace_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_workspace_id_name_key" ON "payment_methods"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "payments_workspace_id_order_id_idx" ON "payments"("workspace_id", "order_id");

-- CreateIndex
CREATE INDEX "payments_workspace_id_customer_id_idx" ON "payments"("workspace_id", "customer_id");

-- CreateIndex
CREATE INDEX "payments_workspace_id_status_paid_at_idx" ON "payments"("workspace_id", "status", "paid_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_workspace_id_payment_number_key" ON "payments"("workspace_id", "payment_number");

-- CreateIndex
CREATE INDEX "customer_credits_workspace_id_customer_id_idx" ON "customer_credits"("workspace_id", "customer_id");

-- CreateIndex
CREATE INDEX "receipts_workspace_id_order_id_idx" ON "receipts"("workspace_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_workspace_id_receipt_number_key" ON "receipts"("workspace_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "expense_categories_workspace_id_name_key" ON "expense_categories"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "expenses_workspace_id_expense_date_idx" ON "expenses"("workspace_id", "expense_date");

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credits" ADD CONSTRAINT "customer_credits_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Amounts are always positive; the direction of money is given by the payment type.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_status_valid" CHECK ("status" IN ('POSTED', 'VOIDED'));
-- A payment that moves money names its method and account; applied credit moves none.
ALTER TABLE "payments" ADD CONSTRAINT "payments_method_unless_credit"
  CHECK ("type" = 'CREDIT_APPLIED' OR ("payment_method_id" IS NOT NULL AND "account_id" IS NOT NULL));
-- Every payment belongs to an order or a customer (an advance has only the customer).
ALTER TABLE "payments" ADD CONSTRAINT "payments_has_subject" CHECK ("order_id" IS NOT NULL OR "customer_id" IS NOT NULL);
