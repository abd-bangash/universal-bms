-- CreateEnum
CREATE TYPE "product_type" AS ENUM ('STOCKABLE', 'NON_STOCKABLE', 'SERVICE', 'BUNDLE');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "tracking_mode" AS ENUM ('NONE', 'BATCH', 'SERIAL');

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category_id" TEXT,
    "brand_id" TEXT,
    "type" "product_type" NOT NULL DEFAULT 'STOCKABLE',
    "status" "product_status" NOT NULL DEFAULT 'ACTIVE',
    "made_to_order" BOOLEAN NOT NULL DEFAULT false,
    "tracking" "tracking_mode" NOT NULL DEFAULT 'NONE',
    "base_unit_id" TEXT,
    "sale_unit_id" TEXT,
    "purchase_unit_id" TEXT,
    "sale_unit_factor" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "purchase_unit_factor" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "base_price" DECIMAL(18,4) NOT NULL,
    "cost_price" DECIMAL(18,4),
    "tax_class_id" TEXT,
    "tags" TEXT[],
    "aliases" TEXT[],
    "visible_in_pos" BOOLEAN NOT NULL DEFAULT true,
    "visible_to_ai" BOOLEAN NOT NULL DEFAULT true,
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "price_override" DECIMAL(18,4),
    "cost_override" DECIMAL(18,4),
    "weight" DECIMAL(18,4),
    "min_stock_level" DECIMAL(18,4),
    "max_stock_level" DECIMAL(18,4),
    "status" "product_status" NOT NULL DEFAULT 'ACTIVE',
    "custom_fields" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "file_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bundle_components" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "bundle_product_id" TEXT NOT NULL,
    "component_variant_id" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "bundle_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "price_list_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "price" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_workspace_id_parent_id_idx" ON "categories"("workspace_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_workspace_id_parent_id_name_key" ON "categories"("workspace_id", "parent_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_workspace_id_name_key" ON "brands"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "products_workspace_id_status_category_id_idx" ON "products"("workspace_id", "status", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_workspace_id_code_key" ON "products"("workspace_id", "code");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_workspace_id_sku_key" ON "product_variants"("workspace_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_workspace_id_barcode_key" ON "product_variants"("workspace_id", "barcode");

-- CreateIndex
CREATE INDEX "product_images_workspace_id_product_id_sort_order_idx" ON "product_images"("workspace_id", "product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_images_file_id_idx" ON "product_images"("file_id");

-- CreateIndex
CREATE INDEX "bundle_components_workspace_id_component_variant_id_idx" ON "bundle_components"("workspace_id", "component_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bundle_components_workspace_id_bundle_product_id_component__key" ON "bundle_components"("workspace_id", "bundle_product_id", "component_variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_workspace_id_name_key" ON "price_lists"("workspace_id", "name");

-- CreateIndex
CREATE INDEX "price_list_items_workspace_id_variant_id_idx" ON "price_list_items"("workspace_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_workspace_id_price_list_id_variant_id_key" ON "price_list_items"("workspace_id", "price_list_id", "variant_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_base_unit_id_fkey" FOREIGN KEY ("base_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_sale_unit_id_fkey" FOREIGN KEY ("sale_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_purchase_unit_id_fkey" FOREIGN KEY ("purchase_unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tax_class_id_fkey" FOREIGN KEY ("tax_class_id") REFERENCES "tax_classes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "file_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_bundle_product_id_fkey" FOREIGN KEY ("bundle_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bundle_components" ADD CONSTRAINT "bundle_components_component_variant_id_fkey" FOREIGN KEY ("component_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_price_list_id_fkey" FOREIGN KEY ("price_list_id") REFERENCES "price_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Root categories have a NULL parent_id, which a plain unique index treats as distinct: enforce names there too.
CREATE UNIQUE INDEX "categories_workspace_root_name_key" ON "categories"("workspace_id", "name") WHERE "parent_id" IS NULL;

-- At most one default variant per product, and one default price list per workspace.
CREATE UNIQUE INDEX "product_variants_one_default_key" ON "product_variants"("product_id") WHERE "is_default";
CREATE UNIQUE INDEX "price_lists_one_default_key" ON "price_lists"("workspace_id") WHERE "is_default";

-- Custom-field filters (?cf.<key>=) use JSONB containment.
CREATE INDEX "products_custom_fields_gin" ON "products" USING GIN ("custom_fields" jsonb_path_ops);
CREATE INDEX "product_variants_custom_fields_gin" ON "product_variants" USING GIN ("custom_fields" jsonb_path_ops);

-- Fuzzy search on name, code, SKU and barcode.
CREATE INDEX "products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "products_code_trgm" ON "products" USING GIN ("code" gin_trgm_ops);
CREATE INDEX "product_variants_sku_trgm" ON "product_variants" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "product_variants_barcode_trgm" ON "product_variants" USING GIN ("barcode" gin_trgm_ops);
