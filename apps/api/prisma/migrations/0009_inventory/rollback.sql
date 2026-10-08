-- Reverses 0009_inventory. Drops the inventory tables and enums; stock history is lost.
DROP TRIGGER IF EXISTS stock_movements_append_only ON "stock_movements";
DROP TABLE IF EXISTS "stock_count_lines" CASCADE;
DROP TABLE IF EXISTS "stock_counts" CASCADE;
DROP TABLE IF EXISTS "stock_reservations" CASCADE;
DROP TABLE IF EXISTS "stock_levels" CASCADE;
DROP TABLE IF EXISTS "stock_movements" CASCADE;
DROP TABLE IF EXISTS "adjustment_reasons" CASCADE;
DROP FUNCTION IF EXISTS stock_movements_reject_change();
DROP TYPE IF EXISTS "reservation_status";
DROP TYPE IF EXISTS "movement_type";
