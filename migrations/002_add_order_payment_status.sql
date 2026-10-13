BEGIN;

ALTER TABLE orders
    ADD COLUMN payment_status VARCHAR(30) NOT NULL DEFAULT 'UNPAID';

ALTER TABLE orders
    ADD CONSTRAINT chk_orders_payment_status
    CHECK (
        payment_status IN (
            'UNPAID',
            'PENDING',
            'PAID',
            'FAILED',
            'REFUND_PENDING',
            'REFUNDED'
        )
    );

COMMIT;