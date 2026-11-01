BEGIN;

ALTER TABLE public.cultivation_sessions
  ADD COLUMN IF NOT EXISTS harvest_status VARCHAR;

UPDATE public.cultivation_sessions
SET harvest_status = 'NOT_READY'
WHERE harvest_status IS NULL;

ALTER TABLE public.cultivation_sessions
  ALTER COLUMN harvest_status SET DEFAULT 'NOT_READY',
  ALTER COLUMN harvest_status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cultivation_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%harvest_status%'
  ) THEN
    ALTER TABLE public.cultivation_sessions
      ADD CONSTRAINT chk_cultivation_sessions_harvest_status
      CHECK (harvest_status IN ('NOT_READY', 'HARVEST_READY')) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cultivation_issues'::regclass
      AND conname = 'cultivation_issues_status_check'
  ) THEN
    ALTER TABLE public.cultivation_issues
      ADD CONSTRAINT cultivation_issues_status_check
      CHECK (status IN ('OPEN', 'WAITING_EXPERT', 'IN_PROGRESS', 'MONITORING', 'RESOLVED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.expert_consultations'::regclass
      AND conname = 'expert_consultations_status_check'
  ) THEN
    ALTER TABLE public.expert_consultations
      ADD CONSTRAINT expert_consultations_status_check
      CHECK (status IN ('PENDING', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'));
  END IF;
END
$$;

ALTER TABLE public.cultivation_issues
  ALTER COLUMN session_tray_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS spawn_inspection_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cultivation_issues'::regclass
      AND conname = 'fk_issue_spawn_inspection'
  ) THEN
    ALTER TABLE public.cultivation_issues
      ADD CONSTRAINT fk_issue_spawn_inspection
      FOREIGN KEY (spawn_inspection_id)
      REFERENCES public.spawn_inspections(inspection_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.disease_treatment_logs (
  treatment_log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consultation_id INTEGER NOT NULL
    REFERENCES public.expert_consultations(consultation_id),
  performed_by INTEGER NOT NULL REFERENCES public.users(user_id),
  action_description TEXT NOT NULL,
  result_description TEXT,
  performed_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.treatment_media (
  media_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  treatment_log_id BIGINT NOT NULL
    REFERENCES public.disease_treatment_logs(treatment_log_id),
  media_url TEXT NOT NULL,
  media_type VARCHAR NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
  media_stage VARCHAR NOT NULL CHECK (media_stage IN ('BEFORE', 'DURING', 'AFTER')),
  caption TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES public.users(user_id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT now()
);

COMMIT;
