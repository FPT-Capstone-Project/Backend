const pool = require('../config/db');

const sessionFloors = `
  SELECT s.session_id, s.start_at, s.end_at,
         f.floor_id, f.floor_name, f.master_id, f.node_address,
         f.misting_ssr_channel, m.light_ssr_channel,
         MIN(st.assigned_at) AS assigned_at
  FROM cultivation_sessions s
  INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
  INNER JOIN cultivation_session_trays st ON st.session_id = s.session_id
  INNER JOIN cultivation_trays t ON t.tray_id = st.tray_id
  INNER JOIN cultivation_floors f ON f.floor_id = t.floor_id
  INNER JOIN iot_masters m ON m.id = f.master_id
  WHERE s.session_id = $1
  GROUP BY s.session_id, s.start_at, s.end_at, f.floor_id, f.floor_name,
           f.master_id, f.node_address, f.misting_ssr_channel, m.light_ssr_channel
`;

async function findSessionOwner(sessionId, userId) {
  const result = await pool.query(
    `SELECT s.session_id, o.user_id
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE s.session_id = $1 AND ($2::integer IS NULL OR o.user_id = $2)`,
    [sessionId, userId],
  );
  return result.rows[0] || null;
}

async function findDeviceHistory(sessionId, { limit, offset }) {
  const values = [sessionId, limit, offset];
  const [count, events] = await Promise.all([
    pool.query(
      `WITH session_floors AS (${sessionFloors})
       SELECT COUNT(DISTINCT c.id)::int AS total
       FROM session_floors sf
       INNER JOIN iot_device_commands c
         ON c.master_id = sf.master_id
        AND (c.channel = sf.misting_ssr_channel OR c.channel = sf.light_ssr_channel)
        AND c.requested_at >= GREATEST(sf.start_at, sf.assigned_at)
        AND c.requested_at <= COALESCE(sf.end_at, now())`,
      values.slice(0, 1),
    ),
    pool.query(
      `WITH session_floors AS (${sessionFloors})
       SELECT c.id AS "commandId", c.channel, c.action, c.status,
              CASE WHEN c.requested_by IS NULL THEN 'AUTOMATIC' ELSE 'MANUAL' END AS "controlMode",
              c.requested_at AS "requestedAt", c.published_at AS "publishedAt",
              c.completed_at AS "completedAt", c.error_message AS "errorMessage",
              c.error_message AS reason,
              COALESCE(
                json_agg(DISTINCT jsonb_build_object(
                  'floorId', sf.floor_id,
                  'floorName', sf.floor_name,
                  'deviceType', CASE
                    WHEN c.channel = sf.misting_ssr_channel THEN 'MISTING'
                    ELSE 'LIGHT'
                  END
                )) FILTER (WHERE sf.floor_id IS NOT NULL),
                '[]'::json
              ) AS floors
       FROM session_floors sf
       INNER JOIN iot_device_commands c
         ON c.master_id = sf.master_id
        AND (c.channel = sf.misting_ssr_channel OR c.channel = sf.light_ssr_channel)
        AND c.requested_at >= GREATEST(sf.start_at, sf.assigned_at)
        AND c.requested_at <= COALESCE(sf.end_at, now())
       GROUP BY c.id
       ORDER BY c.requested_at DESC, c.id DESC
       LIMIT $2 OFFSET $3`,
      values,
    ),
  ]);
  return { deviceEvents: events.rows, total: count.rows[0].total };
}

async function findSensorHistory(sessionId, { limit, offset }) {
  const values = [sessionId, limit, offset];
  const [count, readings] = await Promise.all([
    pool.query(
      `WITH session_floors AS (${sessionFloors})
       SELECT COUNT(*)::int AS total
       FROM session_floors sf
       INNER JOIN iot_sensor_readings r
         ON r.master_id = sf.master_id AND r.node_address = sf.node_address
        AND r.received_at >= GREATEST(sf.start_at, sf.assigned_at)
        AND r.received_at <= COALESCE(sf.end_at, now())`,
      values.slice(0, 1),
    ),
    pool.query(
      `WITH session_floors AS (${sessionFloors})
       SELECT r.id, r.temperature, r.humidity,
              (r.is_valid AND NOT r.retained
                AND r.received_at >= now() - interval '60 seconds') AS ok,
              r.received_at AS "receivedAt", r.measured_at AS "measuredAt",
              r.retained, sf.floor_name AS "floorName", sf.floor_id AS "floorId",
              r.sensor_address AS "sensorId"
       FROM session_floors sf
       INNER JOIN iot_sensor_readings r
         ON r.master_id = sf.master_id AND r.node_address = sf.node_address
        AND r.received_at >= GREATEST(sf.start_at, sf.assigned_at)
        AND r.received_at <= COALESCE(sf.end_at, now())
       ORDER BY r.received_at DESC, r.id DESC
       LIMIT $2 OFFSET $3`,
      values,
    ),
  ]);
  return { readings: readings.rows, total: count.rows[0].total };
}

module.exports = { findSessionOwner, findDeviceHistory, findSensorHistory };
