CREATE OR REPLACE FUNCTION public.save_cultivation_environment_history(
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  IF p_period_start IS NULL
    OR p_period_end IS NULL
    OR p_period_end - p_period_start <> INTERVAL '10 minutes'
    OR date_bin(INTERVAL '10 minutes', p_period_start, TIMESTAMPTZ '2000-01-01 00:00:00+00') <> p_period_start
  THEN
    RAISE EXCEPTION 'Expected an aligned 10-minute period';
  END IF;

  WITH session_floors AS (
    SELECT s.session_id, s.start_at, s.end_at,
           MIN(st.assigned_at) AS assigned_at,
           f.floor_id, f.master_id, f.node_address
    FROM public.cultivation_sessions s
    INNER JOIN public.cultivation_session_trays st
      ON st.session_id = s.session_id AND st.status = 'ACTIVE'
    INNER JOIN public.cultivation_trays t
      ON t.tray_id = st.tray_id AND t.status = 'OCCUPIED'
    INNER JOIN public.cultivation_floors f
      ON f.floor_id = t.floor_id AND f.status = 'ACTIVE'
    WHERE s.status = 'CULTIVATING'
      AND s.start_at::timestamptz < p_period_end
      AND (s.end_at IS NULL OR s.end_at::timestamptz > p_period_start)
    GROUP BY s.session_id, s.start_at, s.end_at,
             f.floor_id, f.master_id, f.node_address
  ),
  sensor_averages AS (
    SELECT sf.session_id, sf.floor_id, r.sensor_address,
           AVG(r.temperature) FILTER (
             WHERE r.temperature BETWEEN -40 AND 125
           ) AS temperature_avg,
           AVG(r.humidity) FILTER (
             WHERE r.humidity BETWEEN 0 AND 100
           ) AS humidity_avg
    FROM session_floors sf
    INNER JOIN public.iot_sensor_readings r
      ON r.master_id = sf.master_id
     AND r.node_address = sf.node_address
     AND r.received_at >= GREATEST(
       p_period_start,
       sf.start_at::timestamptz,
       sf.assigned_at::timestamptz
     )
     AND r.received_at < LEAST(
       p_period_end,
       COALESCE(sf.end_at::timestamptz, p_period_end)
     )
    WHERE r.is_valid AND NOT r.retained
    GROUP BY sf.session_id, sf.floor_id, r.sensor_address
  ),
  floor_averages AS (
    SELECT session_id, floor_id,
           AVG(temperature_avg) FILTER (WHERE temperature_avg IS NOT NULL) AS temperature_avg,
           AVG(humidity_avg) FILTER (WHERE humidity_avg IS NOT NULL) AS humidity_avg
    FROM sensor_averages
    GROUP BY session_id, floor_id
  )
  INSERT INTO public.cultivation_environment_history (
    session_id, floor_id, period_start, period_end, growth_stage,
    temperature_avg, humidity_avg
  )
  SELECT sf.session_id, sf.floor_id, p_period_start, p_period_end,
         COALESCE(progress.current_stage, 'UNKNOWN'),
         averages.temperature_avg, averages.humidity_avg
  FROM session_floors sf
  LEFT JOIN floor_averages averages
    ON averages.session_id = sf.session_id AND averages.floor_id = sf.floor_id
  LEFT JOIN LATERAL (
    SELECT cp.current_stage
    FROM public.cultivation_progress cp
    WHERE cp.session_id = sf.session_id
      AND cp.current_stage IS NOT NULL
      AND cp.updated_at::timestamptz < p_period_end
    ORDER BY cp.updated_at DESC, cp.progress_id DESC
    LIMIT 1
  ) progress ON TRUE
  ON CONFLICT (session_id, floor_id, period_start) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;
