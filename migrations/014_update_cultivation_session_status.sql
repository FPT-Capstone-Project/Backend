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
    'HARVESTING',
    'COMPLETED',
    'CANCELLED'
  )) NOT VALID;

ALTER TABLE public.cultivation_sessions
  ALTER COLUMN status SET DEFAULT 'PENDING';

COMMIT;
