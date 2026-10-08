-- Reverses 0006_sales. Drops the sales tables and enums; quotations, orders and invoices are lost.
DROP TABLE IF EXISTS "return_lines" CASCADE;
DROP TABLE IF EXISTS "returns" CASCADE;
DROP TABLE IF EXISTS "invoices" CASCADE;
DROP TABLE IF EXISTS "production_jobs" CASCADE;
DROP TABLE IF EXISTS "order_salespeople" CASCADE;
DROP TABLE IF EXISTS "order_items" CASCADE;
DROP TABLE IF EXISTS "orders" CASCADE;
DROP TABLE IF EXISTS "quotation_items" CASCADE;
DROP TABLE IF EXISTS "quotations" CASCADE;
DROP TYPE IF EXISTS "order_payment_status";
DROP TYPE IF EXISTS "line_kind";
DROP TYPE IF EXISTS "quotation_status";
