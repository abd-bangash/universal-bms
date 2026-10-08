-- Messaging and AI (task 69): connections, webhook events, conversations, messages, templates, consent, knowledge and AI records.
-- CreateEnum
CREATE TYPE "message_direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- DropIndex

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "display_name" TEXT,
    "external_account_id" TEXT,
    "config_encrypted" TEXT NOT NULL,
    "last_success_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "workspace_id" TEXT,
    "connection_id" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "external_contact_id" TEXT NOT NULL,
    "contact_name" TEXT,
    "contact_phone" TEXT,
    "customer_id" TEXT,
    "lead_id" TEXT,
    "assigned_to_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "automation_active" BOOLEAN NOT NULL DEFAULT true,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
    "needs_human" BOOLEAN NOT NULL DEFAULT false,
    "needs_human_reason" TEXT,
    "last_message_at" TIMESTAMP(3),
    "last_inbound_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "external_id" TEXT,
    "direction" "message_direction" NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_user_id" TEXT,
    "type" TEXT NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "template_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "failure_reason" TEXT,
    "provider_timestamp" TIMESTAMP(3) NOT NULL,
    "channel_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "channel" TEXT,
    "body" TEXT NOT NULL,
    "variables" TEXT[],
    "provider_name" TEXT,
    "language" TEXT,
    "provider_status" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_consents" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "channel_type" TEXT NOT NULL,
    "external_contact_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_flows" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "category_id" TEXT,
    "steps" JSONB NOT NULL,

    CONSTRAINT "question_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "lead_id" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "flags" TEXT[],
    "confidence" DECIMAL(5,4),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "applied_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action_logs" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "suggestion_id" TEXT,
    "action_type" TEXT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "model_version" TEXT,
    "prompt_version" TEXT NOT NULL,
    "prompt_hash" TEXT NOT NULL,
    "response_hash" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER,
    "confidence_score" DECIMAL(5,4),
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "human_approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_workspace_id_provider_key" ON "integration_connections"("workspace_id", "provider");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_dedupe_key_key" ON "webhook_events"("provider", "dedupe_key");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_status_last_message_at_idx" ON "conversations"("workspace_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_assigned_to_id_status_idx" ON "conversations"("workspace_id", "assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_customer_id_idx" ON "conversations"("workspace_id", "customer_id");

-- CreateIndex
CREATE INDEX "conversations_workspace_id_lead_id_idx" ON "conversations"("workspace_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_workspace_id_connection_id_external_contact_i_key" ON "conversations"("workspace_id", "connection_id", "external_contact_id");

-- CreateIndex
CREATE INDEX "messages_workspace_id_conversation_id_provider_timestamp_idx" ON "messages"("workspace_id", "conversation_id", "provider_timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "messages_workspace_id_conversation_id_external_id_key" ON "messages"("workspace_id", "conversation_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_workspace_id_kind_name_key" ON "message_templates"("workspace_id", "kind", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contact_consents_workspace_id_channel_type_external_contact_key" ON "contact_consents"("workspace_id", "channel_type", "external_contact_id");

-- CreateIndex
CREATE INDEX "knowledge_items_workspace_id_active_idx" ON "knowledge_items"("workspace_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "question_flows_workspace_id_category_id_key" ON "question_flows"("workspace_id", "category_id");

-- CreateIndex
CREATE INDEX "ai_suggestions_workspace_id_conversation_id_created_at_idx" ON "ai_suggestions"("workspace_id", "conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_workspace_id_lead_id_idx" ON "ai_suggestions"("workspace_id", "lead_id");

-- CreateIndex
CREATE INDEX "ai_action_logs_workspace_id_created_at_idx" ON "ai_action_logs"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_action_logs_workspace_id_conversation_id_idx" ON "ai_action_logs"("workspace_id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_workspace_id_day_key" ON "ai_usage"("workspace_id", "day");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_flows" ADD CONSTRAINT "question_flows_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_flows" ADD CONSTRAINT "question_flows_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_logs" ADD CONSTRAINT "ai_action_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_logs" ADD CONSTRAINT "ai_action_logs_suggestion_id_fkey" FOREIGN KEY ("suggestion_id") REFERENCES "ai_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action_logs" ADD CONSTRAINT "ai_action_logs_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One connected account belongs to one workspace across the whole platform: a webhook finds its
-- workspace from the account id alone (Requirement 42.1, 42.2).
CREATE UNIQUE INDEX "integration_connections_provider_account_unique"
  ON "integration_connections" ("provider", "external_account_id")
  WHERE "external_account_id" IS NOT NULL;

-- Values the code relies on.
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_status_valid" CHECK ("status" IN ('CONNECTED', 'DISCONNECTED', 'ERROR'));
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_status_valid" CHECK ("status" IN ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED'));
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_kind_valid" CHECK ("kind" IN ('message', 'status', 'lead_form'));
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_attempts_nonneg" CHECK ("attempts" >= 0);
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_status_valid" CHECK ("status" IN ('OPEN', 'PENDING', 'CLOSED'));
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_unread_nonneg" CHECK ("unread_count" >= 0);
ALTER TABLE "messages" ADD CONSTRAINT "messages_status_valid" CHECK ("status" IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'));
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_valid" CHECK ("sender_type" IN ('CUSTOMER', 'STAFF', 'AI', 'AUTOMATION', 'SYSTEM'));
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_kind_valid" CHECK ("kind" IN ('QUICK_REPLY', 'MESSAGE', 'PROVIDER', 'NOTIFICATION', 'BANK_DETAILS'));
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_status_valid" CHECK ("status" IN ('OPTED_IN', 'OPTED_OUT', 'UNKNOWN'));
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_status_valid" CHECK ("status" IN ('PENDING', 'APPROVED', 'EDITED', 'REJECTED', 'SUPERSEDED', 'AUTO_SENT'));
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_confidence_range" CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1));
ALTER TABLE "ai_action_logs" ADD CONSTRAINT "ai_action_logs_outcome_valid" CHECK ("outcome" IN ('SUCCESS', 'FAILED', 'TIMEOUT', 'DISABLED', 'LIMIT_REACHED'));
ALTER TABLE "ai_action_logs" ADD CONSTRAINT "ai_action_logs_confidence_range" CHECK ("confidence_score" IS NULL OR ("confidence_score" >= 0 AND "confidence_score" <= 1));
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_counts_nonneg" CHECK ("requests" >= 0 AND "tokens" >= 0);

-- Inbox search (Requirement 31.1) matches contact names and phone numbers with ILIKE.
CREATE INDEX "conversations_contact_name_trgm" ON "conversations" USING GIN ("contact_name" gin_trgm_ops);
CREATE INDEX "conversations_contact_phone_trgm" ON "conversations" USING GIN ("contact_phone" gin_trgm_ops);
