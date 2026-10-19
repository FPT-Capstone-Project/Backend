BEGIN;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS payos_payment_link_id TEXT,
    ADD COLUMN IF NOT EXISTS payos_checkout_url TEXT,
    ADD COLUMN IF NOT EXISTS payos_qr_code TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_transaction_code
    ON payments (transaction_code)
    WHERE transaction_code IS NOT NULL;

COMMIT;
