BEGIN;

DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.shipments'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%SHIPPED%'
      AND pg_get_constraintdef(oid) LIKE '%DELIVERED%'
  LOOP
    EXECUTE format('ALTER TABLE public.shipments DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_status_check
  CHECK (status IN ('PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'RETURNED'));

COMMIT;
