BEGIN;

ALTER TABLE public.cultivation_inspections
  DROP COLUMN IF EXISTS growth_stage,
  DROP COLUMN IF EXISTS growth_progress;

COMMIT;
