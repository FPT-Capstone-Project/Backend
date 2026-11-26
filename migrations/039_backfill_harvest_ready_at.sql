-- Readiness confirmation inserts its system notification and progress entry in the same transaction.
-- Restore the timestamp only when that notification matches the latest progress entry.
WITH latest_progress AS (
  SELECT DISTINCT ON (session_id) session_id, current_stage, updated_at
  FROM public.cultivation_progress
  ORDER BY session_id, progress_id DESC
)
UPDATE public.cultivation_sessions s
SET harvest_ready_at = p.updated_at
FROM latest_progress p
WHERE s.session_id = p.session_id
  AND s.status IN ('CULTIVATING', 'HARVEST_READY')
  AND s.harvest_status = 'HARVEST_READY'
  AND s.harvest_ready_at IS NULL
  AND p.current_stage = 'MATURATION'
  AND EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.reference_type = 'CULTIVATION_SESSION' AND n.reference_id = s.session_id
      AND n.notification_type = 'OPERATOR_MESSAGE' AND n.created_by IS NULL
      AND n.title = 'Mushrooms ready for harvest'
      AND n.message = 'Please choose pickup at the farm or external delivery.'
      AND n.created_at = p.updated_at
  );
