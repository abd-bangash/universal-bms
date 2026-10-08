-- Reverses 0007_invoice_immutable.
DROP TRIGGER IF EXISTS invoices_immutable ON "invoices";
DROP FUNCTION IF EXISTS invoices_reject_change();
