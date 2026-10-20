DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'rentals'
          AND column_name = 'order_item_id'
    ) THEN
        ALTER TABLE rentals DROP CONSTRAINT IF EXISTS fk_rentals_order_item;
        ALTER TABLE rentals DROP CONSTRAINT IF EXISTS fk_rentals_package;
        ALTER TABLE rentals DROP CONSTRAINT IF EXISTS chk_rental_dates;
        ALTER TABLE rentals DROP CONSTRAINT IF EXISTS chk_rental_price;
        ALTER TABLE rentals DROP CONSTRAINT IF EXISTS chk_rental_status;
        ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_status_check;
        ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_duration_days_check;

        ALTER TABLE rentals ADD COLUMN IF NOT EXISTS order_id INT;
        ALTER TABLE rentals ADD COLUMN IF NOT EXISTS duration_days INT;

        UPDATE rentals r
        SET order_id = oi.order_id,
            duration_days = rp.duration_days
        FROM order_items oi
        INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
        WHERE r.order_item_id = oi.order_item_id;

        UPDATE rentals
        SET status = 'CONFIRMED'
        WHERE status = 'PENDING';

        ALTER TABLE rentals
            ALTER COLUMN start_date TYPE TIMESTAMP USING start_date::timestamp,
            ALTER COLUMN end_date TYPE TIMESTAMP USING end_date::timestamp,
            ALTER COLUMN start_date DROP NOT NULL,
            ALTER COLUMN end_date DROP NOT NULL;

        ALTER TABLE rentals DROP COLUMN order_item_id;
        ALTER TABLE rentals DROP COLUMN package_id;
        ALTER TABLE rentals DROP COLUMN total_price;
    END IF;
END
$$;

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS chk_order_item_type;
ALTER TABLE order_items
    ADD CONSTRAINT chk_order_item_type
    CHECK (
        (
            item_type = 'MUSHROOM'
            AND mushroom_type_id IS NOT NULL
            AND rental_package_id IS NULL
        )
        OR
        (
            item_type = 'RENTAL'
            AND rental_package_id IS NOT NULL
        )
    );

ALTER TABLE rentals
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE rentals r
SET duration_days = rp.duration_days
FROM order_items oi
INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
WHERE r.order_id = oi.order_id
  AND r.duration_days IS NULL
  AND oi.item_type = 'RENTAL';

UPDATE rentals
SET status = 'CONFIRMED'
WHERE status = 'PENDING';

UPDATE rentals
SET updated_at = CURRENT_TIMESTAMP
WHERE updated_at IS NULL;

ALTER TABLE rentals
    ALTER COLUMN order_id SET NOT NULL,
    ALTER COLUMN duration_days SET NOT NULL,
    ALTER COLUMN start_date DROP NOT NULL,
    ALTER COLUMN end_date DROP NOT NULL,
    ALTER COLUMN status TYPE VARCHAR(20),
    ALTER COLUMN status SET DEFAULT 'CONFIRMED';

ALTER TABLE rentals DROP CONSTRAINT IF EXISTS chk_rental_dates;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS chk_rental_status;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_duration_days_check;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_status_check;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_date_check;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS fk_rentals_user;
ALTER TABLE rentals DROP CONSTRAINT IF EXISTS fk_rentals_tray;

ALTER TABLE rentals
    ADD CONSTRAINT rentals_duration_days_check CHECK (duration_days > 0),
    ADD CONSTRAINT rentals_status_check
        CHECK (status IN ('CONFIRMED', 'PREPARING', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
    ADD CONSTRAINT rentals_date_check
        CHECK (start_date IS NULL OR end_date IS NULL OR end_date > start_date),
    ADD CONSTRAINT fk_rentals_user
        FOREIGN KEY (user_id) REFERENCES users(user_id),
    ADD CONSTRAINT fk_rentals_tray
        FOREIGN KEY (tray_id) REFERENCES cultivation_trays(tray_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'rentals'::regclass
          AND conname = 'uq_rentals_order_id'
    ) THEN
        ALTER TABLE rentals
            ADD CONSTRAINT uq_rentals_order_id UNIQUE (order_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'rentals'::regclass
          AND conname = 'fk_rentals_order'
    ) THEN
        ALTER TABLE rentals
            ADD CONSTRAINT fk_rentals_order FOREIGN KEY (order_id) REFERENCES orders(order_id);
    END IF;
END
$$;

INSERT INTO rentals (order_id, user_id, duration_days, status)
SELECT o.order_id, o.user_id, MIN(rp.duration_days), 'CONFIRMED'
FROM orders o
INNER JOIN order_items oi ON oi.order_id = o.order_id AND oi.item_type = 'RENTAL'
INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
WHERE o.payment_status = 'PAID'
  AND o.status IN ('PAID', 'CONFIRMED', 'PROCESSING', 'COMPLETED')
GROUP BY o.order_id, o.user_id
ON CONFLICT (order_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_rentals_user_id ON rentals(user_id);
CREATE INDEX IF NOT EXISTS idx_rentals_status ON rentals(status);
CREATE INDEX IF NOT EXISTS idx_rentals_tray_id ON rentals(tray_id);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_rentals_updated_at'
          AND tgrelid = 'rentals'::regclass
          AND NOT tgisinternal
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_rentals_updated_at
                 BEFORE UPDATE ON rentals
                 FOR EACH ROW
                 EXECUTE FUNCTION update_updated_at_column()';
    END IF;
END
$$;
