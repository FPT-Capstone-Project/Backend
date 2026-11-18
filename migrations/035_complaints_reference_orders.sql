BEGIN;

ALTER TABLE public.complaints ADD COLUMN order_id INTEGER;

UPDATE public.complaints c
SET order_id = sh.order_id
FROM public.shipments sh
WHERE sh.shipment_id = c.shipment_id;

-- Fail and roll back if any existing complaint cannot be mapped; never delete it.
ALTER TABLE public.complaints ALTER COLUMN order_id SET NOT NULL;
ALTER TABLE public.complaints ADD CONSTRAINT complaints_order_id_fkey
  FOREIGN KEY (order_id) REFERENCES public.orders(order_id);

-- Preserve even multiple historical complaints from different shipments of one order.
-- New submissions are serialized by locking the order and reject existing complaints.
CREATE INDEX complaints_order_id_idx ON public.complaints(order_id);
ALTER TABLE public.complaints DROP COLUMN shipment_id;

COMMIT;
