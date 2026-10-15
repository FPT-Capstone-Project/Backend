BEGIN;

ALTER TABLE orders
    DROP CONSTRAINT IF EXISTS chk_order_status;

ALTER TABLE orders
    ADD CONSTRAINT chk_order_status
    CHECK (
        status IN (
            'PENDING',
            'PAID',
            'CONFIRMED',
            'PROCESSING',
            'COMPLETED',
            'CANCELLED'
        )
    );

COMMIT;
