-- Commissions (task 59): rules and the commissions earned on orders.
-- CreateEnum
CREATE TYPE "commission_calc_type" AS ENUM ('PERCENTAGE', 'FIXED_PER_ORDER', 'FIXED_PER_UNIT');

-- CreateEnum
CREATE TYPE "commission_base" AS ENUM ('NET_SALES', 'GROSS_SALES', 'GROSS_PROFIT');

-- CreateEnum
CREATE TYPE "commission_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID', 'REVERSED');

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "calc_type" "commission_calc_type" NOT NULL,
    "rate" DECIMAL(18,4) NOT NULL,
    "base_type" "commission_base" NOT NULL DEFAULT 'NET_SALES',
    "scope" TEXT NOT NULL DEFAULT 'ALL',
    "scope_id" TEXT,
    "salesperson_id" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_item_id" TEXT,
    "salesperson_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "rule_snapshot" JSONB NOT NULL,
    "calculation_base" DECIMAL(18,4) NOT NULL,
    "share_percent" DECIMAL(9,4) NOT NULL DEFAULT 100,
    "amount" DECIMAL(18,4) NOT NULL,
    "status" "commission_status" NOT NULL DEFAULT 'PENDING',
    "reversal_of_id" TEXT,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "paid_method" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_rules_workspace_id_active_salesperson_id_idx" ON "commission_rules"("workspace_id", "active", "salesperson_id");

-- CreateIndex
CREATE INDEX "commissions_workspace_id_salesperson_id_status_idx" ON "commissions"("workspace_id", "salesperson_id", "status");

-- CreateIndex
CREATE INDEX "commissions_workspace_id_order_id_idx" ON "commissions"("workspace_id", "order_id");

-- CreateIndex
CREATE INDEX "commissions_workspace_id_created_at_idx" ON "commissions"("workspace_id", "created_at");

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_salesperson_id_fkey" FOREIGN KEY ("salesperson_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "commission_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A rule's rate cannot be negative, and its scope must say what it points at.
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_rate_nonneg" CHECK ("rate" >= 0);
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_scope_valid" CHECK (
  ("scope" = 'ALL' AND "scope_id" IS NULL)
  OR ("scope" IN ('CATEGORY', 'PRODUCT', 'ORDER_TYPE') AND "scope_id" IS NOT NULL)
);

-- A share is a percentage of the line; amounts are positive, except on the rows that reverse another.
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_share_valid" CHECK ("share_percent" > 0 AND "share_percent" <= 100);
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_amount_sign" CHECK (
  ("reversal_of_id" IS NULL AND "amount" >= 0) OR ("reversal_of_id" IS NOT NULL AND "amount" <= 0)
);
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_paid_has_date" CHECK ("status" <> 'PAID' OR "paid_at" IS NOT NULL);
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_approved_has_approver" CHECK (
  "status" NOT IN ('APPROVED', 'REJECTED', 'PAID') OR "approved_by_id" IS NOT NULL
);

-- One commission per order, salesperson and line (a per-order rule has no line): calculating the
-- same order twice cannot pay it twice. Rows that reverse another are not counted.
CREATE UNIQUE INDEX "commissions_one_per_order_salesperson_line" ON "commissions"
  ("workspace_id", "order_id", "salesperson_id", COALESCE("order_item_id", ''))
  WHERE "reversal_of_id" IS NULL;
