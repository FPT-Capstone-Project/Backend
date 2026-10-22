-- Permanently removes stored substrate moisture thresholds.
-- Deploy the backend that no longer references these columns before running.
BEGIN;

ALTER TABLE mushroom_conditions
    DROP CONSTRAINT IF EXISTS chk_substrate_moisture_range,
    DROP COLUMN IF EXISTS substrate_moisture_min,
    DROP COLUMN IF EXISTS substrate_moisture_max;

COMMIT;
