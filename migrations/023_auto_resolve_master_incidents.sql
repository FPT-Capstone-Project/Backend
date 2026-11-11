BEGIN;
-- Automatic recovery for MASTER, NODE and SENSOR incidents.
ALTER TABLE device_incidents ADD COLUMN IF NOT EXISTS auto_resolved BOOLEAN NOT NULL DEFAULT false;
-- Replace the old unnamed resolution check, preserving target/status checks.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid='device_incidents'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%resolved_by%'
      AND pg_get_constraintdef(oid) LIKE '%resolved_at%'
  LOOP
    EXECUTE format('ALTER TABLE device_incidents DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE device_incidents ADD CONSTRAINT device_incidents_resolution_check CHECK (
  (status='OPEN' AND resolved_at IS NULL AND resolved_by IS NULL AND NOT auto_resolved)
  OR (status='RESOLVED' AND resolved_at IS NOT NULL AND (
    (NOT auto_resolved AND resolved_by IS NOT NULL)
    OR (auto_resolved AND resolved_by IS NULL)
  ))
);
COMMIT;
