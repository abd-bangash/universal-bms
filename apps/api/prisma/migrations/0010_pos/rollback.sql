-- Reverses 0010_pos. The sessions go; orders, returns and payments keep existing without a session.
ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "orders_pos_session_id_fkey";
ALTER TABLE "returns" DROP CONSTRAINT IF EXISTS "returns_pos_session_id_fkey";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_pos_session_id_fkey";
DROP TABLE IF EXISTS "cash_movements" CASCADE;
DROP TABLE IF EXISTS "pos_sessions" CASCADE;
