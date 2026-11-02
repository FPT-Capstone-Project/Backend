BEGIN;

ALTER TABLE public.cultivation_sessions
  DROP CONSTRAINT IF EXISTS cultivation_sessions_status_check;
ALTER TABLE public.cultivation_sessions
  DROP CONSTRAINT IF EXISTS chk_session_status;
ALTER TABLE public.cultivation_sessions
  ADD CONSTRAINT chk_session_status CHECK (status IN (
    'PENDING',
    'SPAWN_RESTING',
    'MYCELIAL_DEVELOPMENT',
    'READY_FOR_CULTIVATION',
    'CULTIVATING',
    'HARVEST_READY',
    'HARVESTING',
    'COMPLETED',
    'CANCELLED'
  )) NOT VALID;

ALTER TABLE public.harvests
  ADD COLUMN IF NOT EXISTS session_id INTEGER,
  ADD COLUMN IF NOT EXISTS status VARCHAR,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.harvests'::regclass
      AND conname = 'fk_harvests_session'
  ) THEN
    ALTER TABLE public.harvests
      ADD CONSTRAINT fk_harvests_session
      FOREIGN KEY (session_id)
      REFERENCES public.cultivation_sessions(session_id);
  END IF;
END
$$;

UPDATE public.harvests h
SET session_id = hr.session_id
FROM public.harvest_requests hr
WHERE h.harvest_request_id = hr.harvest_request_id
  AND h.session_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.harvests existing_harvest
    WHERE existing_harvest.session_id = hr.session_id
  );

UPDATE public.harvests h
SET session_id = st.session_id
FROM public.cultivation_session_trays st
WHERE h.session_tray_id = st.session_tray_id
  AND h.session_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.harvests existing_harvest
    WHERE existing_harvest.session_id = st.session_id
  );

-- Keep one legacy row per session linked; historical per-tray rows remain intact.
WITH ranked_harvests AS (
  SELECT harvest_id,
         row_number() OVER (PARTITION BY session_id ORDER BY harvest_id) AS row_number
  FROM public.harvests
  WHERE session_id IS NOT NULL
)
UPDATE public.harvests h
SET session_id = NULL
FROM ranked_harvests ranked
WHERE h.harvest_id = ranked.harvest_id
  AND ranked.row_number > 1;

UPDATE public.harvests
SET status = 'COMPLETED'
WHERE status IS NULL;

UPDATE public.harvests
SET updated_at = CURRENT_TIMESTAMP
WHERE updated_at IS NULL;

ALTER TABLE public.harvests
  ALTER COLUMN harvest_date DROP NOT NULL,
  ALTER COLUMN status SET DEFAULT 'PLANNED',
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.harvests'::regclass
      AND conname = 'chk_harvests_status'
  ) THEN
    ALTER TABLE public.harvests
      ADD CONSTRAINT chk_harvests_status
      CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.harvests'::regclass
      AND conname = 'chk_harvests_total_weight_nonnegative'
  ) THEN
    ALTER TABLE public.harvests
      ADD CONSTRAINT chk_harvests_total_weight_nonnegative
      CHECK (total_weight_kg IS NULL OR total_weight_kg >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.harvests'::regclass
      AND conname = 'chk_harvests_usable_weight_nonnegative'
  ) THEN
    ALTER TABLE public.harvests
      ADD CONSTRAINT chk_harvests_usable_weight_nonnegative
      CHECK (usable_weight_kg IS NULL OR usable_weight_kg >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.harvests'::regclass
      AND conname = 'chk_harvests_rejected_weight_nonnegative'
  ) THEN
    ALTER TABLE public.harvests
      ADD CONSTRAINT chk_harvests_rejected_weight_nonnegative
      CHECK (rejected_weight_kg IS NULL OR rejected_weight_kg >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.harvests'::regclass
      AND conname = 'chk_harvests_weight_classification'
  ) THEN
    ALTER TABLE public.harvests
      ADD CONSTRAINT chk_harvests_weight_classification
      CHECK (
        total_weight_kg IS NULL
        OR usable_weight_kg IS NULL
        OR rejected_weight_kg IS NULL
        OR usable_weight_kg + rejected_weight_kg = total_weight_kg
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.harvests'::regclass
      AND conname = 'uq_harvests_session_id'
  ) THEN
    ALTER TABLE public.harvests
      ADD CONSTRAINT uq_harvests_session_id UNIQUE (session_id);
  END IF;
END
$$;

COMMIT;
