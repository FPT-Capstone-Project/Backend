BEGIN;

ALTER TABLE public.harvest_requests
  ADD COLUMN IF NOT EXISTS delivery_address TEXT;

COMMIT;
