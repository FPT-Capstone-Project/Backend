BEGIN;

-- Restore timestamp defaults defined in database.sql and migration 017.
-- Preserve TIMESTAMPTZ types and existing data; do not default business deadlines.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.cultivation_inspection_images
  ALTER COLUMN uploaded_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.cultivation_progress
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.cultivation_protocols
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.cultivation_rooms
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.cultivation_session_trays
  ALTER COLUMN assigned_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.cultivation_sessions
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.cultivation_trays
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.disease_treatment_logs
  ALTER COLUMN performed_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.expert_consultations
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.harvests
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.inventory_transactions
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.mushroom_conditions
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.mushroom_types
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.orders
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.payments
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.spawn_inventory
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.tray_positions
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.tray_reservations
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.treatment_media
  ALTER COLUMN uploaded_at SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE public.users
  ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP;

COMMIT;
