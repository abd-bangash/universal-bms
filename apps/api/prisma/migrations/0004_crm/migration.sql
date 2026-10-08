-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phones" TEXT[],
    "phones_normalized" TEXT[],
    "email" CITEXT,
    "billing_address" JSONB,
    "shipping_address" JSONB,
    "preferred_channel" TEXT,
    "notes" TEXT,
    "tags" TEXT[],
    "source" TEXT,
    "channel" TEXT,
    "campaign" TEXT,
    "assigned_to_id" TEXT,
    "price_list_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "is_walk_in" BOOLEAN NOT NULL DEFAULT false,
    "merged_into_id" TEXT,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "phone_normalized" TEXT,
    "email" CITEXT,
    "source" TEXT,
    "channel" TEXT,
    "campaign" TEXT,
    "ad_id" TEXT,
    "form_id" TEXT,
    "interest" TEXT,
    "product_id" TEXT,
    "requirements" TEXT,
    "quantity" DECIMAL(18,4),
    "estimated_value" DECIMAL(18,4),
    "quoted_amount" DECIMAL(18,4),
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "assigned_to_id" TEXT,
    "lost_reason_id" TEXT,
    "next_action" TEXT,
    "next_action_date" TIMESTAMP(3),
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "closed_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_reasons" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "lost_reasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_entries" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "lead_id" TEXT,
    "order_id" TEXT,
    "type" TEXT NOT NULL,
    "ref_type" TEXT,
    "ref_id" TEXT,
    "summary" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_workspace_id_status_idx" ON "customers"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "customers_workspace_id_assigned_to_id_idx" ON "customers"("workspace_id", "assigned_to_id");

-- CreateIndex
CREATE INDEX "leads_workspace_id_stage_idx" ON "leads"("workspace_id", "stage");

-- CreateIndex
CREATE INDEX "leads_workspace_id_phone_normalized_idx" ON "leads"("workspace_id", "phone_normalized");

-- CreateIndex
CREATE INDEX "leads_workspace_id_assigned_to_id_idx" ON "leads"("workspace_id", "assigned_to_id");

-- CreateIndex
CREATE INDEX "leads_workspace_id_customer_id_idx" ON "leads"("workspace_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "lost_reasons_workspace_id_name_key" ON "lost_reasons"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "timeline_entries_workspace_id_customer_id_occurred_at_idx" ON "timeline_entries"("workspace_id", "customer_id", "occurred_at");

-- CreateIndex
CREATE INDEX "timeline_entries_workspace_id_lead_id_occurred_at_idx" ON "timeline_entries"("workspace_id", "lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "timeline_entries_workspace_id_order_id_occurred_at_idx" ON "timeline_entries"("workspace_id", "order_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_lost_reason_id_fkey" FOREIGN KEY ("lost_reason_id") REFERENCES "lost_reasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_reasons" ADD CONSTRAINT "lost_reasons_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_entries" ADD CONSTRAINT "timeline_entries_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One walk-in customer per workspace (anonymous counter sales attach to it).
CREATE UNIQUE INDEX "customers_one_walk_in_key" ON "customers"("workspace_id") WHERE "is_walk_in";

-- Duplicate detection by phone, custom-field filters, and fuzzy name search.
CREATE INDEX "customers_phones_normalized_gin" ON "customers" USING GIN ("phones_normalized");
CREATE INDEX "customers_custom_fields_gin" ON "customers" USING GIN ("custom_fields" jsonb_path_ops);
CREATE INDEX "customers_full_name_trgm" ON "customers" USING GIN ("full_name" gin_trgm_ops);
CREATE INDEX "leads_custom_fields_gin" ON "leads" USING GIN ("custom_fields" jsonb_path_ops);
CREATE INDEX "leads_full_name_trgm" ON "leads" USING GIN ("full_name" gin_trgm_ops);
CREATE INDEX "leads_interest_trgm" ON "leads" USING GIN ("interest" gin_trgm_ops);

-- Workspaces that exist before this migration get their walk-in customer now; new ones get it on creation.
INSERT INTO "customers" ("id", "workspace_id", "full_name", "is_walk_in", "status", "updated_at")
SELECT gen_random_uuid()::text, w."id", 'Walk-in customer', true, 'ACTIVE', CURRENT_TIMESTAMP
FROM "workspaces" w
WHERE NOT EXISTS (SELECT 1 FROM "customers" c WHERE c."workspace_id" = w."id" AND c."is_walk_in");
