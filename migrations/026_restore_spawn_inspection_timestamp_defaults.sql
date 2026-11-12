BEGIN;

-- CREATE TABLE IF NOT EXISTS in migration 013 does not repair existing tables.
-- Inserts omit these timestamps and rely on the database to populate them.
ALTER TABLE public.spawn_inspections
  ALTER COLUMN inspected_at SET DEFAULT now(),
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.spawn_inspection_images
  ALTER COLUMN created_at SET DEFAULT now();

COMMIT;
