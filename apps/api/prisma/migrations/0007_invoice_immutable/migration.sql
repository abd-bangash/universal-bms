-- An issued invoice is never edited or removed; corrections are a new invoice or a credit note
-- (Requirement 29.6). The database itself rejects UPDATE and DELETE, like the audit log.
CREATE FUNCTION invoices_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'invoices are immutable once issued: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER invoices_immutable
  BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION invoices_reject_change();
