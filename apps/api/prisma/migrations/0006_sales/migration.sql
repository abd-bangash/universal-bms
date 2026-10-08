-- CreateEnum
CREATE TYPE "quotation_status" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED');

-- CreateEnum
CREATE TYPE "line_kind" AS ENUM ('CATALOG', 'CUSTOM');

-- CreateEnum
CREATE TYPE "order_payment_status" AS ENUM ('UNPAID', 'DEPOSIT_PAID', 'PARTIALLY_PAID', 'PAID', 'OVERPAID', 'REFUNDED');

-- CreateTable
CREATE TABLE "quotations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "quotation_number" TEXT NOT NULL,
    "customer_id" TEXT,
    "lead_id" TEXT,
    "status" "quotation_status" NOT NULL DEFAULT 'DRAFT',
    "valid_until" TIMESTAMP(3),
    "subtotal" DECIMAL(18,4) NOT NULL,
    "discount_type" TEXT,
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "terms" TEXT,
    "source" TEXT,
    "channel" TEXT,
    "campaign" TEXT,
    "assigned_to_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "sent_via" TEXT,
    "sent_snapshot" JSONB,
    "viewed_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "accepted_via" TEXT,
    "acceptance_recorded_by_id" TEXT,
    "acceptance_file_id" TEXT,
    "rejected_reason" TEXT,
    "root_id" TEXT,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "is_latest" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "quotation_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "kind" "line_kind" NOT NULL DEFAULT 'CATALOG',
    "product_id" TEXT,
    "variant_id" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_id" TEXT,
    "list_price" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "discount_type" TEXT,
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_class_id" TEXT,
    "tax_rate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "field_snapshot" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "quotation_id" TEXT,
    "order_type" TEXT NOT NULL DEFAULT 'STANDARD',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "channel" TEXT,
    "campaign" TEXT,
    "location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "payment_status" "order_payment_status" NOT NULL DEFAULT 'UNPAID',
    "order_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(18,4) NOT NULL,
    "discount_type" TEXT,
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "rounding_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(18,4) NOT NULL,
    "deposit_required" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "returned_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance_due" DECIMAL(18,4) NOT NULL,
    "fulfilment_method" TEXT,
    "delivery_address" JSONB,
    "scheduled_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "delivered_by_id" TEXT,
    "receiver_name" TEXT,
    "proof_file_id" TEXT,
    "notes" TEXT,
    "internal_notes" TEXT,
    "assigned_to_id" TEXT,
    "pos_session_id" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "kind" "line_kind" NOT NULL DEFAULT 'CATALOG',
    "product_id" TEXT,
    "variant_id" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "returned_qty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unit_id" TEXT,
    "list_price" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "cost_price" DECIMAL(18,4),
    "discount_type" TEXT,
    "discount_value" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discount_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "tax_class_id" TEXT,
    "tax_rate" DECIMAL(9,4) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(18,4) NOT NULL,
    "stock_tracked" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "field_snapshot" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_salespeople" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "share_percent" DECIMAL(9,4) NOT NULL DEFAULT 100,

    CONSTRAINT "order_salespeople_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_jobs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "assigned_to_id" TEXT,
    "due_date" TIMESTAMP(3),
    "notes" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_amount" DECIMAL(18,4) NOT NULL,
    "data" JSONB NOT NULL,
    "issued_by_id" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "return_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_amount" DECIMAL(18,4) NOT NULL,
    "refund_to" TEXT NOT NULL,
    "pos_session_id" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_lines" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotations_workspace_id_status_created_at_idx" ON "quotations"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "quotations_workspace_id_customer_id_idx" ON "quotations"("workspace_id", "customer_id");

-- CreateIndex
CREATE INDEX "quotations_workspace_id_lead_id_idx" ON "quotations"("workspace_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_workspace_id_quotation_number_version_number_key" ON "quotations"("workspace_id", "quotation_number", "version_number");

-- CreateIndex
CREATE INDEX "quotation_items_workspace_id_quotation_id_idx" ON "quotation_items"("workspace_id", "quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_items_workspace_id_quotation_id_line_no_key" ON "quotation_items"("workspace_id", "quotation_id", "line_no");

-- CreateIndex
CREATE INDEX "orders_workspace_id_status_order_date_idx" ON "orders"("workspace_id", "status", "order_date");

-- CreateIndex
CREATE INDEX "orders_workspace_id_customer_id_idx" ON "orders"("workspace_id", "customer_id");

-- CreateIndex
CREATE INDEX "orders_workspace_id_assigned_to_id_idx" ON "orders"("workspace_id", "assigned_to_id");

-- CreateIndex
CREATE INDEX "orders_workspace_id_payment_status_idx" ON "orders"("workspace_id", "payment_status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_workspace_id_order_number_key" ON "orders"("workspace_id", "order_number");

-- CreateIndex
CREATE INDEX "order_items_workspace_id_order_id_idx" ON "order_items"("workspace_id", "order_id");

-- CreateIndex
CREATE INDEX "order_items_workspace_id_variant_id_idx" ON "order_items"("workspace_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_workspace_id_order_id_line_no_key" ON "order_items"("workspace_id", "order_id", "line_no");

-- CreateIndex
CREATE INDEX "order_salespeople_workspace_id_user_id_idx" ON "order_salespeople"("workspace_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_salespeople_workspace_id_order_id_user_id_key" ON "order_salespeople"("workspace_id", "order_id", "user_id");

-- CreateIndex
CREATE INDEX "production_jobs_workspace_id_status_idx" ON "production_jobs"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "production_jobs_workspace_id_order_id_idx" ON "production_jobs"("workspace_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "production_jobs_workspace_id_order_item_id_key" ON "production_jobs"("workspace_id", "order_item_id");

-- CreateIndex
CREATE INDEX "invoices_workspace_id_order_id_idx" ON "invoices"("workspace_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_workspace_id_invoice_number_key" ON "invoices"("workspace_id", "invoice_number");

-- CreateIndex
CREATE INDEX "returns_workspace_id_order_id_idx" ON "returns"("workspace_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "returns_workspace_id_return_number_key" ON "returns"("workspace_id", "return_number");

-- CreateIndex
CREATE INDEX "return_lines_workspace_id_return_id_idx" ON "return_lines"("workspace_id", "return_id");

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_salespeople" ADD CONSTRAINT "order_salespeople_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_salespeople" ADD CONSTRAINT "order_salespeople_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_salespeople" ADD CONSTRAINT "order_salespeople_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_jobs" ADD CONSTRAINT "production_jobs_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fuzzy search on document numbers, and custom-field filters on orders and quotations.
CREATE INDEX "orders_order_number_trgm" ON "orders" USING GIN ("order_number" gin_trgm_ops);
CREATE INDEX "quotations_quotation_number_trgm" ON "quotations" USING GIN ("quotation_number" gin_trgm_ops);
CREATE INDEX "orders_custom_fields_gin" ON "orders" USING GIN ("custom_fields" jsonb_path_ops);
CREATE INDEX "quotations_custom_fields_gin" ON "quotations" USING GIN ("custom_fields" jsonb_path_ops);

-- A quotation has one latest version; money on a document can never be negative.
CREATE UNIQUE INDEX "quotations_one_latest_key" ON "quotations"("workspace_id", "quotation_number") WHERE "is_latest";
ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "total_amount" >= 0 AND "deposit_required" >= 0 AND "paid_amount" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0 AND "unit_price" >= 0);
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quantity_positive" CHECK ("quantity" > 0 AND "unit_price" >= 0);
