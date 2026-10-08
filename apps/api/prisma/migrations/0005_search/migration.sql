-- Global search (task 29): trigram indexes for the columns searched with ILIKE that had none.
CREATE INDEX "customers_email_trgm" ON "customers" USING GIN ((email::text) gin_trgm_ops);
CREATE INDEX "leads_email_trgm" ON "leads" USING GIN ((email::text) gin_trgm_ops);
CREATE INDEX "leads_phone_normalized_trgm" ON "leads" USING GIN ("phone_normalized" gin_trgm_ops);
