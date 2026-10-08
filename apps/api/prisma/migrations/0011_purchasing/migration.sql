-- Purchasing (task 55): suppliers, purchase orders and their items, goods receipts, supplier payments and returns.
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
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expected_date" TIMESTAMP(3),
    "subtotal" DECIMAL(18,4) NOT NULL,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "variant_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_cost" DECIMAL(18,4) NOT NULL,
    "received_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "returned_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "receipt_number" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "received_by_id" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "lines" JSONB NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "purchase_order_id" TEXT,
    "payment_method_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "paid_at" TIMESTAMP(3) NOT NULL,
    "reference_number" TEXT,
    "status" "payment_status" NOT NULL DEFAULT 'CONFIRMED',
    "void_reason" TEXT,
    "recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_returns" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "purchase_order_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "total_amount" DECIMAL(18,4) NOT NULL,
    "lines" JSONB NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suppliers_workspace_id_status_name_idx" ON "suppliers"("workspace_id", "status", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_workspace_id_supplier_id_order_date_idx" ON "purchase_orders"("workspace_id", "supplier_id", "order_date");

-- CreateIndex
CREATE INDEX "purchase_orders_workspace_id_status_idx" ON "purchase_orders"("workspace_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_workspace_id_order_number_key" ON "purchase_orders"("workspace_id", "order_number");

-- CreateIndex
CREATE INDEX "purchase_order_items_workspace_id_purchase_order_id_idx" ON "purchase_order_items"("workspace_id", "purchase_order_id");

-- CreateIndex
CREATE INDEX "purchase_order_items_workspace_id_variant_id_idx" ON "purchase_order_items"("workspace_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_items_workspace_id_purchase_order_id_line_no_key" ON "purchase_order_items"("workspace_id", "purchase_order_id", "line_no");

-- CreateIndex
CREATE INDEX "goods_receipts_workspace_id_purchase_order_id_idx" ON "goods_receipts"("workspace_id", "purchase_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_workspace_id_receipt_number_key" ON "goods_receipts"("workspace_id", "receipt_number");

-- CreateIndex
CREATE INDEX "supplier_payments_workspace_id_supplier_id_paid_at_idx" ON "supplier_payments"("workspace_id", "supplier_id", "paid_at");

-- CreateIndex
CREATE INDEX "supplier_returns_workspace_id_supplier_id_idx" ON "supplier_returns"("workspace_id", "supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_returns_workspace_id_return_number_key" ON "supplier_returns"("workspace_id", "return_number");

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "financial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Quantities and money cannot go negative; what was returned cannot exceed what was received.
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_unit_cost_nonneg" CHECK ("unit_cost" >= 0 AND "line_total" >= 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_received_nonneg" CHECK ("received_qty" >= 0);
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_returned_within_received" CHECK ("returned_qty" >= 0 AND "returned_qty" <= "received_qty");
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_amounts_nonneg" CHECK ("subtotal" >= 0 AND "tax_amount" >= 0 AND "total_amount" >= 0);
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "supplier_returns" ADD CONSTRAINT "supplier_returns_total_nonneg" CHECK ("total_amount" >= 0);
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_status_valid" CHECK ("status" IN ('ACTIVE', 'ARCHIVED'));

-- Supplier search (Requirement 31.1) matches names, phones and emails with ILIKE.
CREATE INDEX "suppliers_name_trgm" ON "suppliers" USING GIN ((name::text) gin_trgm_ops);
