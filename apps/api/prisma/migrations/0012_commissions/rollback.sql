-- Reverses 0012_commissions.
DROP TABLE IF EXISTS "commissions" CASCADE;
DROP TABLE IF EXISTS "commission_rules" CASCADE;
DROP TYPE IF EXISTS "commission_status";
DROP TYPE IF EXISTS "commission_base";
DROP TYPE IF EXISTS "commission_calc_type";
