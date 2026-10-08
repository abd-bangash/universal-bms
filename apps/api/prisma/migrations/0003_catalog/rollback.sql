-- Reverses 0003_catalog. Drops the catalog tables and enums; catalog data is lost.
DROP TABLE IF EXISTS "price_list_items" CASCADE;
DROP TABLE IF EXISTS "price_lists" CASCADE;
DROP TABLE IF EXISTS "bundle_components" CASCADE;
DROP TABLE IF EXISTS "product_images" CASCADE;
DROP TABLE IF EXISTS "product_variants" CASCADE;
DROP TABLE IF EXISTS "products" CASCADE;
DROP TABLE IF EXISTS "brands" CASCADE;
DROP TABLE IF EXISTS "categories" CASCADE;
DROP TYPE IF EXISTS "tracking_mode";
DROP TYPE IF EXISTS "product_status";
DROP TYPE IF EXISTS "product_type";
