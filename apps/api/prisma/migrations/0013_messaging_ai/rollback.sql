-- Reverses 0013_messaging_ai.
DROP TABLE IF EXISTS "ai_usage" CASCADE;
DROP TABLE IF EXISTS "ai_action_logs" CASCADE;
DROP TABLE IF EXISTS "ai_suggestions" CASCADE;
DROP TABLE IF EXISTS "question_flows" CASCADE;
DROP TABLE IF EXISTS "knowledge_items" CASCADE;
DROP TABLE IF EXISTS "contact_consents" CASCADE;
DROP TABLE IF EXISTS "messages" CASCADE;
DROP TABLE IF EXISTS "message_templates" CASCADE;
DROP TABLE IF EXISTS "conversations" CASCADE;
DROP TABLE IF EXISTS "webhook_events" CASCADE;
DROP TABLE IF EXISTS "integration_connections" CASCADE;
DROP TYPE IF EXISTS "message_direction";
