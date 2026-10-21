BEGIN;

DO $$
DECLARE
    orphan_count BIGINT;
    orphan_ids TEXT;
BEGIN
    SELECT
        COUNT(*),
        string_agg(cs.rental_id::TEXT, ', ' ORDER BY cs.rental_id)
    INTO orphan_count, orphan_ids
    FROM cultivation_sessions AS cs
    LEFT JOIN rentals AS r ON r.rental_id = cs.rental_id
    WHERE cs.rental_id IS NOT NULL
      AND r.rental_id IS NULL;

    IF orphan_count > 0 THEN
        RAISE EXCEPTION
            'Cannot add fk_sessions_rental: % orphan cultivation_sessions rows (rental_id(s): %)',
            orphan_count,
            orphan_ids;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'cultivation_sessions'::regclass
          AND conname = 'fk_sessions_rental'
    ) THEN
        ALTER TABLE cultivation_sessions
            ADD CONSTRAINT fk_sessions_rental
            FOREIGN KEY (rental_id)
            REFERENCES rentals(rental_id)
            ON DELETE RESTRICT;
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS rental_status_logs (
    log_id SERIAL PRIMARY KEY,
    rental_id INT NOT NULL REFERENCES rentals(rental_id) ON DELETE CASCADE,
    action VARCHAR(40) NOT NULL,
    from_status VARCHAR(20),
    to_status VARCHAR(20),
    performed_by INT REFERENCES users(user_id),
    note TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rental_status_logs_rental
    ON rental_status_logs(rental_id, created_at);

CREATE INDEX IF NOT EXISTS idx_progress_session_latest
    ON cultivation_progress(session_id, progress_id DESC);

COMMIT;
