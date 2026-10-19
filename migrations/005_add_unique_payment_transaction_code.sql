BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS ux_payments_transaction_code
    ON payments (transaction_code)
    WHERE transaction_code IS NOT NULL;

COMMIT;
