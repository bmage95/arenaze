-- ============================================================================
-- Arenaze — Phase 1, batch 2
--   1. Device Manager: per-device games catalog + controller count.
--   2. Account Ledger: payment method, paid/pending status, and a human
--      sequential invoice number on every transaction.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- devices: games available on the machine + number of controllers (consoles)
-- ---------------------------------------------------------------------------
ALTER TABLE devices ADD COLUMN games       text[]  NOT NULL DEFAULT '{}';
ALTER TABLE devices ADD COLUMN controllers integer NOT NULL DEFAULT 0 CHECK (controllers >= 0);

-- ---------------------------------------------------------------------------
-- transactions: payment method, paid/pending status, sequential invoice no.
-- ---------------------------------------------------------------------------
ALTER TABLE transactions ADD COLUMN method text NOT NULL DEFAULT 'Cash' CHECK (method IN ('Cash','UPI','Card'));
ALTER TABLE transactions ADD COLUMN status text NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid'));

CREATE SEQUENCE IF NOT EXISTS invoice_no_seq START 1001;
ALTER TABLE transactions ADD COLUMN invoice_no text;

-- Backfill any existing rows in chronological order: INV-1001, INV-1002, ...
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM transactions
)
UPDATE transactions t SET invoice_no = 'INV-' || (1000 + o.rn)::text
FROM ordered o WHERE t.id = o.id;

-- Continue the sequence after the backfilled range, then make it the column default.
SELECT setval('invoice_no_seq', 1001 + (SELECT count(*) FROM transactions), false);
ALTER TABLE transactions ALTER COLUMN invoice_no SET DEFAULT ('INV-' || nextval('invoice_no_seq'));
ALTER TABLE transactions ALTER COLUMN invoice_no SET NOT NULL;
CREATE UNIQUE INDEX idx_tx_invoice_no ON transactions(tenant_id, invoice_no);
