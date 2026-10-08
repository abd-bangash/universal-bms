-- Reverses 0008_finance. Drops the finance tables and enums; payments, expenses and receipts are lost.
DROP TABLE IF EXISTS "expenses" CASCADE;
DROP TABLE IF EXISTS "expense_categories" CASCADE;
DROP TABLE IF EXISTS "receipts" CASCADE;
DROP TABLE IF EXISTS "customer_credits" CASCADE;
DROP TABLE IF EXISTS "payments" CASCADE;
DROP TABLE IF EXISTS "payment_methods" CASCADE;
DROP TABLE IF EXISTS "financial_accounts" CASCADE;
DROP TYPE IF EXISTS "payment_status";
DROP TYPE IF EXISTS "payment_type";
