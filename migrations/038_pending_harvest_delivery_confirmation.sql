-- Keep existing harvest deliveries eligible for customer confirmation under the new flow.
UPDATE public.shipments sh
SET status = 'PENDING'
FROM public.harvest_requests hr
JOIN public.cultivation_sessions s ON s.session_id = hr.session_id
JOIN public.harvests h ON h.harvest_request_id = hr.harvest_request_id AND h.session_id = s.session_id
WHERE sh.harvest_request_id = hr.harvest_request_id
  AND sh.order_id = s.order_id
  AND sh.status IN ('SHIPPED', 'IN_TRANSIT')
  AND hr.harvest_method = 'DELIVERY'
  AND hr.status NOT IN ('COMPLETED', 'CANCELLED')
  AND s.status = 'HARVESTING'
  AND h.status = 'COMPLETED';
