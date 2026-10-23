BEGIN;

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS rental_id INT
    REFERENCES rentals(rental_id) ON DELETE SET NULL;

ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS created_by INT
    REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_rental
    ON notifications(rental_id);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON notifications(user_id, created_at DESC);

COMMIT;
