BEGIN;

ALTER TABLE public.cultivation_issues
  ALTER COLUMN session_tray_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS reported_stage TEXT,
  ADD COLUMN IF NOT EXISTS environment_snapshot JSONB;

ALTER TABLE public.cultivation_issues
  DROP CONSTRAINT IF EXISTS cultivation_issues_status_check;
UPDATE public.cultivation_issues
SET status = CASE status
  WHEN 'WAITING_EXPERT' THEN 'PENDING_EXPERT'
  WHEN 'MONITORING' THEN 'IN_PROGRESS'
  ELSE status
END;
ALTER TABLE public.cultivation_issues
  ADD CONSTRAINT cultivation_issues_status_check CHECK (status IN (
    'OPEN', 'PENDING_EXPERT', 'UNDER_DIAGNOSIS', 'NEED_MORE_INFO',
    'SOLUTION_PROVIDED', 'IN_PROGRESS', 'PENDING_REVIEW', 'RESOLVED',
    'REOPENED', 'CANCELLED'
  )) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cultivation_issues'::regclass
      AND conname = 'cultivation_issues_source_check'
  ) THEN
    ALTER TABLE public.cultivation_issues
      ADD CONSTRAINT cultivation_issues_source_check CHECK (
        (session_tray_id IS NOT NULL AND spawn_inspection_id IS NULL)
        OR (session_tray_id IS NULL AND spawn_inspection_id IS NOT NULL)
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.cultivation_issues'::regclass
      AND conname = 'cultivation_issues_source_inspection_check'
  ) THEN
    ALTER TABLE public.cultivation_issues
      ADD CONSTRAINT cultivation_issues_source_inspection_check
      CHECK (spawn_inspection_id IS NULL OR inspection_id IS NULL) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.expert_consultations
  DROP CONSTRAINT IF EXISTS expert_consultations_status_check,
  ADD CONSTRAINT expert_consultations_status_check
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'NEED_MORE_INFO', 'ANSWERED', 'CLOSED'))
    NOT VALID;

CREATE TABLE IF NOT EXISTS public.issue_media (
  media_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  issue_id INTEGER NOT NULL
    REFERENCES public.cultivation_issues(issue_id) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  cloudinary_public_id TEXT,
  media_type VARCHAR NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
  caption TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES public.users(user_id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE public.treatment_media
  ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT;

CREATE TABLE IF NOT EXISTS public.consultation_messages (
  message_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  consultation_id INTEGER NOT NULL
    REFERENCES public.expert_consultations(consultation_id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES public.users(user_id),
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cultivation_issues_spawn_inspection_id
  ON public.cultivation_issues(spawn_inspection_id);
CREATE INDEX IF NOT EXISTS idx_consultation_messages_consultation_id
  ON public.consultation_messages(consultation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_issue_media_issue_id
  ON public.issue_media(issue_id, uploaded_at);
CREATE INDEX IF NOT EXISTS idx_treatment_logs_consultation_id
  ON public.disease_treatment_logs(consultation_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_treatment_media_log_id
  ON public.treatment_media(treatment_log_id, uploaded_at);

COMMIT;
