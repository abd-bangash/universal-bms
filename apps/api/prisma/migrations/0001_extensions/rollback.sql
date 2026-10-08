-- Reverses 0001_extensions. Fails if later migrations still use the extensions, which is intended:
-- roll those back first.
DROP EXTENSION IF EXISTS citext;
DROP EXTENSION IF EXISTS pg_trgm;
