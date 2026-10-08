-- Reverses 0004_crm. Drops the CRM tables; customer, lead and timeline data is lost.
DROP TABLE IF EXISTS "timeline_entries" CASCADE;
DROP TABLE IF EXISTS "leads" CASCADE;
DROP TABLE IF EXISTS "lost_reasons" CASCADE;
DROP TABLE IF EXISTS "customers" CASCADE;
