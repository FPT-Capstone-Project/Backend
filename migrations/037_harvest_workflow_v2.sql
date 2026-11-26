BEGIN;

LOCK TABLE public.order_items, public.cultivation_sessions, public.harvest_requests
  IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  duplicate_id integer;
  legacy_unique record;
BEGIN
  SELECT oi.order_id INTO duplicate_id
  FROM public.cultivation_sessions s JOIN public.order_items oi USING (order_item_id)
  GROUP BY oi.order_id HAVING count(*) > 1 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Order % has multiple cultivation sessions. Reconcile historical references before migration.', duplicate_id;
  END IF;

  SELECT session_id INTO duplicate_id FROM public.harvest_requests
  WHERE status <> 'CANCELLED' GROUP BY session_id HAVING count(*) > 1 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Session % has multiple non-cancelled harvest requests. Reconcile before migration.', duplicate_id;
  END IF;

  FOR legacy_unique IN
    SELECT c.conname FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND c.conkey = ARRAY[a.attnum]
    WHERE c.conrelid = 'public.harvest_requests'::regclass
      AND c.contype = 'u' AND a.attname = 'session_id'
  LOOP
    EXECUTE format('ALTER TABLE public.harvest_requests DROP CONSTRAINT %I', legacy_unique.conname);
  END LOOP;
END $$;

CREATE UNIQUE INDEX uq_active_harvest_request_session
  ON public.harvest_requests(session_id) WHERE status <> 'CANCELLED';

ALTER TABLE public.order_items ADD CONSTRAINT uq_order_items_item_order UNIQUE (order_item_id, order_id);
ALTER TABLE public.cultivation_sessions ADD COLUMN order_id integer;
-- The lifecycle check also applies when backfilling rows with the legacy ACTIVE status.
UPDATE public.cultivation_sessions s
  SET order_id = oi.order_id,
      status = CASE WHEN s.status = 'ACTIVE' THEN 'CULTIVATING' ELSE s.status END
  FROM public.order_items oi WHERE oi.order_item_id = s.order_item_id;
ALTER TABLE public.cultivation_sessions
  ALTER COLUMN order_id SET NOT NULL,
  ADD CONSTRAINT uq_cultivation_sessions_order UNIQUE (order_id),
  ADD CONSTRAINT fk_cultivation_sessions_item_order FOREIGN KEY (order_item_id, order_id)
    REFERENCES public.order_items(order_item_id, order_id) ON UPDATE CASCADE;

CREATE FUNCTION public.set_cultivation_session_order_id() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  SELECT order_id INTO NEW.order_id FROM public.order_items WHERE order_item_id = NEW.order_item_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_cultivation_session_order_id
  BEFORE INSERT OR UPDATE OF order_item_id ON public.cultivation_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_cultivation_session_order_id();

ALTER TABLE public.shipments ADD COLUMN harvest_request_id integer
  UNIQUE REFERENCES public.harvest_requests(harvest_request_id);

-- Bind completed legacy harvests only when their order has an unambiguous shipment.
WITH single_shipments AS (
  SELECT order_id, min(shipment_id) AS shipment_id FROM public.shipments
  GROUP BY order_id HAVING count(*) = 1
)
UPDATE public.shipments sh SET harvest_request_id = hr.harvest_request_id
FROM single_shipments ss
JOIN public.cultivation_sessions s USING (order_id)
JOIN public.harvests h USING (session_id)
JOIN public.harvest_requests hr ON hr.harvest_request_id = h.harvest_request_id
  AND hr.session_id = s.session_id
WHERE sh.shipment_id = ss.shipment_id AND h.status = 'COMPLETED'
  AND hr.harvest_method = 'DELIVERY' AND hr.status <> 'CANCELLED';

COMMIT;
