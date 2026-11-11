BEGIN;

ALTER TABLE public.tray_reservations
  DROP CONSTRAINT IF EXISTS tray_reservations_spawn_quantity_check;

-- Preserve allocations already deducted from inventory for paid orders.
UPDATE public.tray_reservations
SET spawn_quantity = quantity * 2
WHERE status <> 'CONSUMED';

ALTER TABLE public.tray_reservations
  ADD CONSTRAINT tray_reservations_spawn_quantity_check
  CHECK (spawn_quantity = quantity * 2
    OR (status = 'CONSUMED' AND spawn_quantity = quantity * 3));

COMMIT;
