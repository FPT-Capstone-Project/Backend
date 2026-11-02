BEGIN;

-- Session-level observations belong to growth history, not to a single tray inspection.
-- Nullable so existing WF-01/WF-02 records remain valid without rewriting their data.
ALTER TABLE public.cultivation_progress
  ADD COLUMN IF NOT EXISTS condition VARCHAR(500);

COMMIT;
