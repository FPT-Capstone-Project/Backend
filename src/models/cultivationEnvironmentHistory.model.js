const pool = require('../config/db');

const aggregatePeriodSql = `
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
      AND s.start_at::timestamptz < $2::timestamptz
      AND (s.end_at IS NULL OR s.end_at::timestamptz > $1::timestamptz)
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
       $1::timestamptz,
       sf.start_at::timestamptz,
       sf.assigned_at::timestamptz
     )
     AND r.received_at < LEAST(
       $2::timestamptz,
       COALESCE(sf.end_at::timestamptz, $2::timestamptz)
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
  SELECT sf.session_id, sf.floor_id, $1::timestamptz, $2::timestamptz,
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
      AND cp.updated_at::timestamptz < $2::timestamptz
    ORDER BY cp.updated_at DESC, cp.progress_id DESC
    LIMIT 1
  ) progress ON TRUE
  ON CONFLICT (session_id, floor_id, period_start) DO NOTHING
  RETURNING history_id`;

async function findSessionOwner(sessionId) {
  const result = await pool.query(
    `SELECT s.session_id, o.user_id
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE s.session_id = $1`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function findSessionHistory(sessionId, { from, to, limit, offset }) {
  const values = [sessionId, from ?? null, to ?? null, limit, offset];
  const [count, records] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM cultivation_environment_history
       WHERE session_id = $1
         AND ($2::timestamptz IS NULL OR period_start >= $2)
         AND ($3::timestamptz IS NULL OR period_start < $3)`,
      values.slice(0, 3),
    ),
    pool.query(
      `SELECT session_id, floor_id, period_start, period_end,
              growth_stage, temperature_avg, humidity_avg
       FROM cultivation_environment_history
       WHERE session_id = $1
         AND ($2::timestamptz IS NULL OR period_start >= $2)
         AND ($3::timestamptz IS NULL OR period_start < $3)
       ORDER BY period_start ASC, floor_id ASC
       LIMIT $4 OFFSET $5`,
      values,
    ),
  ]);
  return { records: records.rows, total: count.rows[0].total };
}

async function findLatestSessionHistory(sessionId) {
  const result = await pool.query(
    `SELECT session_id, floor_id, period_start, period_end,
            growth_stage, temperature_avg, humidity_avg
     FROM cultivation_environment_history
     WHERE session_id = $1
     ORDER BY period_start DESC, floor_id ASC
     LIMIT 1`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function findSessionReport(sessionId) {
  const [sessionResult, historyResult] = await Promise.all([
    pool.query(
      `SELECT s.session_id,
              GREATEST(s.start_at::timestamptz, MIN(st.assigned_at::timestamptz)) AS start_at,
              s.end_at,
              mc.temperature_min, mc.temperature_max,
              mc.humidity_min, mc.humidity_max
       FROM cultivation_sessions s
       INNER JOIN cultivation_session_trays st ON st.session_id = s.session_id
       LEFT JOIN mushroom_conditions mc ON mc.mushroom_type_id = s.mushroom_type_id
       WHERE s.session_id = $1
       GROUP BY s.session_id, s.start_at, s.end_at,
                mc.temperature_min, mc.temperature_max,
                mc.humidity_min, mc.humidity_max
       LIMIT 1`,
      [sessionId],
    ),
    pool.query(
      `WITH session_floors AS (
         SELECT s.session_id, s.start_at::timestamptz AS start_at,
                s.end_at::timestamptz AS end_at,
                f.floor_id, f.master_id, f.node_address,
                GREATEST(s.start_at::timestamptz, MIN(st.assigned_at::timestamptz)) AS assigned_at
         FROM cultivation_sessions s
         INNER JOIN cultivation_session_trays st ON st.session_id = s.session_id
         INNER JOIN cultivation_trays t ON t.tray_id = st.tray_id
         INNER JOIN cultivation_floors f ON f.floor_id = t.floor_id
         WHERE s.session_id = $1
         GROUP BY s.session_id, s.start_at, s.end_at,
                  f.floor_id, f.master_id, f.node_address
       ), sensor_points AS (
         SELECT sf.session_id, sf.floor_id,
                date_bin(INTERVAL '10 minutes', r.received_at, TIMESTAMPTZ '2000-01-01 00:00:00+00') AS period_start,
                AVG(r.temperature) FILTER (WHERE r.temperature BETWEEN -40 AND 125) AS temperature_avg,
                AVG(r.humidity) FILTER (WHERE r.humidity BETWEEN 0 AND 100) AS humidity_avg
         FROM session_floors sf
         INNER JOIN iot_sensor_readings r
           ON r.master_id = sf.master_id AND r.node_address = sf.node_address
          AND r.received_at >= sf.assigned_at
          AND r.received_at < COALESCE(sf.end_at, CURRENT_TIMESTAMP)
          AND r.is_valid AND NOT r.retained
         GROUP BY sf.session_id, sf.floor_id, period_start
       )
       SELECT points.period_start,
              points.period_start + INTERVAL '10 minutes' AS period_end,
              COALESCE((
                SELECT cp.current_stage
                FROM cultivation_progress cp
                WHERE cp.session_id = points.session_id
                  AND cp.current_stage IS NOT NULL
                  AND cp.updated_at::timestamptz < points.period_start + INTERVAL '10 minutes'
                ORDER BY cp.updated_at DESC, cp.progress_id DESC
                LIMIT 1
              ), 'UNKNOWN') AS growth_stage,
              AVG(points.temperature_avg) FILTER (WHERE points.temperature_avg IS NOT NULL) AS temperature_avg,
              AVG(points.humidity_avg) FILTER (WHERE points.humidity_avg IS NOT NULL) AS humidity_avg
       FROM sensor_points points
       GROUP BY points.session_id, points.period_start
       ORDER BY points.period_start ASC`,
      [sessionId],
    ),
  ]);
  return { session: sessionResult.rows[0] || null, records: historyResult.rows };
}

async function findSessionDailyAverages(sessionId) {
  const result = await pool.query(
    `WITH period_averages AS (
       SELECT period_start,
              AVG(temperature_avg) FILTER (WHERE temperature_avg IS NOT NULL) AS temperature_avg,
              AVG(humidity_avg) FILTER (WHERE humidity_avg IS NOT NULL) AS humidity_avg
       FROM cultivation_environment_history
       WHERE session_id = $1
       GROUP BY period_start
     ),
     daily_averages AS (
       SELECT (period_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS date,
              AVG(temperature_avg) FILTER (WHERE temperature_avg IS NOT NULL) AS temperature_avg,
              AVG(humidity_avg) FILTER (WHERE humidity_avg IS NOT NULL) AS humidity_avg,
              COUNT(*) FILTER (
                WHERE temperature_avg IS NOT NULL OR humidity_avg IS NOT NULL
              )::int AS bucket_count
       FROM period_averages
       GROUP BY (period_start AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
     ),
     date_range AS (
       SELECT MIN(date) AS first_day, MAX(date) AS last_day
       FROM daily_averages
     ),
     calendar_days AS (
       SELECT days.day::date AS date
       FROM date_range
       CROSS JOIN LATERAL generate_series(
         first_day::timestamp, last_day::timestamp, INTERVAL '1 day'
       ) AS days(day)
       WHERE first_day IS NOT NULL
     )
     SELECT calendar_days.date, daily_averages.temperature_avg, daily_averages.humidity_avg,
            COALESCE(daily_averages.bucket_count, 0)::int AS bucket_count
     FROM calendar_days
     LEFT JOIN daily_averages USING (date)
     ORDER BY calendar_days.date ASC`,
    [sessionId],
  );
  return result.rows;
}

async function findFloorHistory(floorId, { from, to, limit, offset }, userId) {
  const values = [floorId, from ?? null, to ?? null, userId ?? null, limit, offset];
  const filter = `floor_id = $1
    AND ($2::timestamptz IS NULL OR period_start >= $2)
    AND ($3::timestamptz IS NULL OR period_start < $3)
    AND ($4::integer IS NULL OR EXISTS (
      SELECT 1
      FROM cultivation_sessions s
      INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
      INNER JOIN orders o ON o.order_id = oi.order_id
      WHERE s.session_id = cultivation_environment_history.session_id
        AND o.user_id = $4
    ))`;
  const [count, records] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM cultivation_environment_history
       WHERE ${filter}`,
      values.slice(0, 4),
    ),
    pool.query(
      `SELECT session_id, floor_id, period_start, period_end,
              growth_stage, temperature_avg, humidity_avg
       FROM cultivation_environment_history
       WHERE ${filter}
       ORDER BY period_start ASC, session_id ASC
       LIMIT $5 OFFSET $6`,
      values,
    ),
  ]);
  return { records: records.rows, total: count.rows[0].total };
}

async function aggregatePeriod(periodStart, periodEnd) {
  const result = await pool.query(
    aggregatePeriodSql,
    [periodStart, periodEnd],
  );
  return result.rowCount;
}

module.exports = {
  findSessionOwner,
  findSessionHistory,
  findLatestSessionHistory,
  findSessionReport,
  findSessionDailyAverages,
  findFloorHistory,
  aggregatePeriod,
  aggregatePeriodSql,
};
