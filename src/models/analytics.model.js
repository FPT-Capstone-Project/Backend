const pool = require('../config/db');

async function getDashboardRevenue() {
  const result = await pool.query(
    'SELECT COALESCE(SUM(total_amount), 0) AS revenue FROM orders WHERE payment_status = $1',
    ['PAID'],
  );
  return result.rows[0];
}

async function getDashboardTraysUsed() {
  const result = await pool.query(
    `SELECT COUNT(st.session_tray_id) AS trays_used
     FROM cultivation_session_trays st
     INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
     INNER JOIN cultivation_trays t ON t.tray_id = st.tray_id
     WHERE st.status = ANY($1::text[]) AND s.status = ANY($2::text[])`,
    [['ACTIVE', 'RELEASED'], ['CULTIVATING', 'HARVEST_READY', 'HARVESTING', 'COMPLETED']],
  );
  return result.rows[0];
}

async function getDashboardHarvestQuality() {
  const result = await pool.query(
    `SELECT COALESCE(SUM(total_weight_kg), 0) AS total_weight,
            COALESCE(SUM(usable_weight_kg), 0) AS usable_weight,
            COALESCE(SUM(rejected_weight_kg), 0) AS rejected_weight
     FROM harvests
     WHERE status = $1
       AND total_weight_kg >= 0 AND usable_weight_kg >= 0 AND rejected_weight_kg >= 0`,
    ['COMPLETED'],
  );
  return result.rows[0];
}

async function getEnvironmentHistory({ from, to, bucketMs }) {
  const result = await pool.query(`
    SELECT f.floor_id AS "floorId", f.floor_name AS "floorName",
      f.floor_number AS "floorNumber", f.room_id AS "roomId",
      f.master_id AS "masterDbId", m.master_identifier AS "masterId",
      f.node_address AS "nodeId",
      json_build_object('temperature_min', c.temperature_min, 'temperature_max', c.temperature_max,
        'humidity_min', c.humidity_min, 'humidity_max', c.humidity_max) AS thresholds,
      history.points
    FROM cultivation_floors f
    JOIN iot_masters m ON m.id=f.master_id
    LEFT JOIN iot_auto_control_configs c ON c.floor_id=f.floor_id
    CROSS JOIN LATERAL (
      WITH sensor_buckets AS (
        SELECT floor(extract(epoch FROM (r.received_at-$1::timestamptz))*1000/$3)::integer AS bucket,
          r.sensor_address,
          avg(r.temperature) FILTER (WHERE r.temperature BETWEEN -40 AND 125) AS temperature,
          avg(r.humidity) FILTER (WHERE r.humidity BETWEEN 0 AND 100) AS humidity
        FROM iot_sensor_readings r
        WHERE r.master_id=f.master_id AND r.node_address=f.node_address
          AND r.received_at >= $1::timestamptz
          AND r.received_at < $2::timestamptz
          AND r.is_valid AND NOT r.retained
          AND r.sensor_address BETWEEN 1 AND 3
        GROUP BY bucket, r.sensor_address
      ), floor_buckets AS (
        -- Give each sensor equal weight regardless of its reporting frequency.
        SELECT bucket, avg(temperature) AS temperature, avg(humidity) AS humidity
        FROM sensor_buckets
        GROUP BY bucket
      )
      SELECT json_agg(json_build_object(
        'timestamp', (extract(epoch FROM $1::timestamptz)*1000 + b.bucket*$3)::double precision,
        'temperature', v.temperature, 'humidity', v.humidity
      ) ORDER BY b.bucket) AS points
      FROM generate_series(0, ceil(extract(epoch FROM ($2::timestamptz-$1::timestamptz))*1000/$3)::integer-1) b(bucket)
      LEFT JOIN floor_buckets v ON v.bucket=b.bucket
    ) history
    WHERE f.status='ACTIVE'
    ORDER BY f.room_id, f.floor_number, f.floor_id`, [from, to, bucketMs]);
  return result.rows;
}

module.exports = { getDashboardRevenue, getDashboardTraysUsed, getDashboardHarvestQuality, getEnvironmentHistory };
