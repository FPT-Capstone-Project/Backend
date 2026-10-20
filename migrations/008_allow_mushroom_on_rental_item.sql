BEGIN;

ALTER TABLE order_items
    DROP CONSTRAINT IF EXISTS chk_order_item_type;

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

COMMIT;
