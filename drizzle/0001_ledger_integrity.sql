-- Ledger is append-only: no UPDATE / DELETE / TRUNCATE on entries.
CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_immutable();
--> statement-breakpoint
-- Every transaction must balance (debits = credits) at commit time.
CREATE OR REPLACE FUNCTION ledger_txn_balanced() RETURNS trigger AS $$
DECLARE
  d numeric;
  c numeric;
BEGIN
  SELECT COALESCE(SUM(debit_minor), 0), COALESCE(SUM(credit_minor), 0) INTO d, c
    FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF d <> c THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (debit %, credit %)', NEW.txn_id, d, c;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_txn_balanced();
