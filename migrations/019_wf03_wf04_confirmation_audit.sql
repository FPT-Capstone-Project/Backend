BEGIN;

-- WF-03: keep readiness separate from lifecycle and record the assessing operator.
ALTER TABLE public.cultivation_sessions
  ADD COLUMN IF NOT EXISTS harvest_ready_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS harvest_ready_by INTEGER REFERENCES public.users(user_id);

-- WF-04: record who confirmed customer pickup or external delivery.
ALTER TABLE public.harvest_requests
  ADD COLUMN IF NOT EXISTS confirmed_by INTEGER REFERENCES public.users(user_id);

COMMIT;
