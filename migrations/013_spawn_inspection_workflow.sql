BEGIN;

ALTER TABLE public.cultivation_sessions
  DROP CONSTRAINT IF EXISTS cultivation_sessions_status_check;
ALTER TABLE public.cultivation_sessions
  DROP CONSTRAINT IF EXISTS chk_session_status;
ALTER TABLE public.cultivation_sessions
  ADD CONSTRAINT chk_session_status CHECK (status IN (
    'PENDING', 'SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT',
    'READY_FOR_CULTIVATION', 'CULTIVATING', 'HARVESTING',
    'COMPLETED', 'CANCELLED'
  )) NOT VALID;

CREATE TABLE IF NOT EXISTS public.spawn_inspections (
  inspection_id        BIGSERIAL PRIMARY KEY,
  session_id           BIGINT NOT NULL REFERENCES public.cultivation_sessions(session_id),
  inspected_by         BIGINT NOT NULL REFERENCES public.users(user_id),
  stage                VARCHAR(50) NOT NULL,
  total_checked        INTEGER NOT NULL,
  normal_quantity      INTEGER NOT NULL DEFAULT 0,
  warning_quantity     INTEGER NOT NULL DEFAULT 0,
  abnormal_quantity    INTEGER NOT NULL DEFAULT 0,
  condition            VARCHAR(30) NOT NULL,
  notes                TEXT,
  replacement_quantity INTEGER NOT NULL DEFAULT 0,
  next_check_at        TIMESTAMP,
  inspected_at         TIMESTAMP NOT NULL DEFAULT now(),
  created_at           TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT chk_si_stage CHECK (stage IN ('RESTING', 'MYCELIAL_DEVELOPMENT')),
  CONSTRAINT chk_si_condition CHECK (condition IN ('NORMAL', 'WARNING', 'ABNORMAL')),
  CONSTRAINT chk_si_total CHECK (total_checked > 0),
  CONSTRAINT chk_si_nonneg CHECK (
    normal_quantity >= 0 AND warning_quantity >= 0
    AND abnormal_quantity >= 0 AND replacement_quantity >= 0
  ),
  CONSTRAINT chk_si_sum CHECK (normal_quantity + warning_quantity + abnormal_quantity = total_checked),
  CONSTRAINT chk_si_replace CHECK (replacement_quantity <= abnormal_quantity),
  CONSTRAINT chk_si_next CHECK (next_check_at IS NULL OR next_check_at >= inspected_at)
);

CREATE INDEX IF NOT EXISTS idx_si_session_inspected
  ON public.spawn_inspections (session_id, inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_abnormal
  ON public.spawn_inspections (inspected_at DESC) WHERE abnormal_quantity > 0;

CREATE TABLE IF NOT EXISTS public.spawn_inspection_images (
  image_id      BIGSERIAL PRIMARY KEY,
  inspection_id BIGINT NOT NULL REFERENCES public.spawn_inspections(inspection_id) ON DELETE CASCADE,
  image_url     TEXT NOT NULL,
  caption       TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sii_inspection
  ON public.spawn_inspection_images (inspection_id);

COMMIT;
