-- Permanently removes stored CO2 thresholds.
-- Deploy the backend that no longer references these columns before running.
BEGIN;

ALTER TABLE mushroom_conditions
    DROP CONSTRAINT IF EXISTS chk_co2_range,
    DROP COLUMN IF EXISTS co2_min,
    DROP COLUMN IF EXISTS co2_max;

COMMIT;
