-- Point of sale (task 50): sessions and cash movements, and the foreign keys that point at them.
-- CreateTable
CREATE TABLE "pos_sessions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "cashier_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "opening_float" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "expected_close" DECIMAL(18,4),
    "actual_close" DECIMAL(18,4),
    "discrepancy" DECIMAL(18,4),
    "close_note" TEXT,
    "closing_data" JSONB,

    CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "pos_session_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_sessions_workspace_id_cashier_id_status_idx" ON "pos_sessions"("workspace_id", "cashier_id", "status");

-- CreateIndex
CREATE INDEX "cash_movements_workspace_id_pos_session_id_idx" ON "cash_movements"("workspace_id", "pos_session_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_pos_session_id_fkey" FOREIGN KEY ("pos_session_id") REFERENCES "pos_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_pos_session_id_fkey" FOREIGN KEY ("pos_session_id") REFERENCES "pos_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_pos_session_id_fkey" FOREIGN KEY ("pos_session_id") REFERENCES "pos_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_pos_session_id_fkey" FOREIGN KEY ("pos_session_id") REFERENCES "pos_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A cashier has at most one open session (Requirement 12.1).
CREATE UNIQUE INDEX "pos_sessions_one_open_per_cashier" ON "pos_sessions" ("workspace_id", "cashier_id") WHERE "status" = 'OPEN';

ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_status_valid" CHECK ("status" IN ('OPEN', 'CLOSED'));
-- A closed session has a closing time; an open one does not.
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_closed_has_time" CHECK (("status" = 'CLOSED') = ("closed_at" IS NOT NULL));
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_direction_valid" CHECK ("direction" IN ('IN', 'OUT'));
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_amount_positive" CHECK ("amount" > 0);
