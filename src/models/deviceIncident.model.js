const pool = require('../config/db');
const AppError = require('../utils/app-error');

// Device notification monitoring is independent of AUTO mode. Allow 60 seconds for
// commissioning a mapping and for temporary telemetry gaps.
const MAX_AGE_SECONDS = 60;

// Node firmware has no heartbeat/status topic. A live sensor packet (including
// an invalid reading) proves node communication, not sensor measurement health.
const masterHealthy = `m.last_seen_at >= now() - make_interval(secs => $1)
  AND NOT COALESCE((m.reported_status='offline' AND m.status_received_at >= m.last_seen_at),false)`;
const nodeHealthy = `EXISTS (SELECT 1 FROM iot_sensor_latest ns
  WHERE ns.master_id=f.master_id AND ns.node_address=f.node_address
    AND NOT ns.retained AND ns.last_received_at >= now() - make_interval(secs => $1))`;

function deviceLabel(incident) {
  if (incident.device_type === 'MASTER') return `Mạch master ${incident.master_id}`;
  if (incident.device_type === 'NODE') return `Node ${incident.node_address} của tầng ID ${incident.floor_id}`;
  return `Cảm biến ${incident.sensor_address} của tầng ID ${incident.floor_id}`;
}

function deviceName(incident) {
  return { MASTER: 'Mạch master', NODE: 'Node', SENSOR: 'Cảm biến' }[incident.device_type];
}

async function transaction(work) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Serialize scans and confirmations across server processes.
    await db.query('SELECT pg_advisory_xact_lock(62004, 1)');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally { db.release(); }
}

async function recover(db) {
  const { rows } = await db.query(`UPDATE device_incidents i SET status='RESOLVED',
    resolved_at=now(), resolved_by=NULL, auto_resolved=true,
    repair_note='Hệ thống tự động xác nhận thiết bị đã hoạt động trở lại.'
    FROM iot_masters m WHERE i.master_id=m.id AND i.status='OPEN'
      AND COALESCE((${masterHealthy}),false)
      AND ((i.device_type='MASTER' AND m.last_seen_at > i.detected_at)
        OR (i.device_type IN ('NODE','SENSOR') AND EXISTS (
          SELECT 1 FROM iot_sensor_latest s WHERE s.master_id=i.master_id
            AND s.node_address=i.node_address AND NOT s.retained
            AND s.last_received_at > i.detected_at
            AND s.last_received_at >= now() - make_interval(secs => $1)
            AND (i.device_type='NODE' OR (s.sensor_address=i.sensor_address AND s.is_valid))
        ))) RETURNING i.*`, [MAX_AGE_SECONDS]);
  for (const incident of rows) {
    await db.query(`INSERT INTO notifications
      (user_id,notification_type,title,message,reference_type,reference_id)
      SELECT DISTINCT u.user_id,'DEVICE_ISSUE',$2::text,$3::text,'DEVICE_INCIDENT',$1::integer
      FROM users u WHERE u.status='ACTIVE' AND (u.role_id IN (1,2) OR EXISTS (
        SELECT 1 FROM notifications n WHERE n.user_id=u.user_id
          AND n.reference_type='DEVICE_INCIDENT' AND n.reference_id=$1))`,
    [incident.incident_id, `${deviceName(incident)} đã phục hồi`,
      `${deviceLabel(incident)} đã hoạt động trở lại. Hệ thống đã tự động xác nhận sự cố được giải quyết, không cần xác nhận thủ công.`]);
  }
}

async function scan() {
  return transaction(async (db) => {
    await recover(db);
    const { rows } = await db.query(`
      WITH floors AS (
        SELECT f.*, COALESCE((${masterHealthy}),false) AS master_healthy,
          (${nodeHealthy}) AS node_healthy
        FROM cultivation_floors f JOIN iot_masters m ON m.id=f.master_id
        WHERE f.status='ACTIVE' AND f.updated_at < now() - make_interval(secs => $1)
      )
      SELECT DISTINCT NULL::integer AS floor_id, master_id, NULL::integer AS node_address,
        NULL::integer AS sensor_address, 'MASTER' AS device_type, 'MASTER_OFFLINE' AS reason
      FROM floors WHERE NOT master_healthy
      UNION ALL
      SELECT floor_id, master_id, node_address, NULL::integer, 'NODE', 'NODE_NO_TELEMETRY'
      FROM floors WHERE master_healthy AND NOT node_healthy
      UNION ALL
      SELECT f.floor_id, f.master_id, f.node_address, a.sensor_address, 'SENSOR',
        CASE WHEN s.master_id IS NULL THEN 'MISSING'
          WHEN NOT s.is_valid THEN 'INVALID' ELSE 'STALE' END AS reason
      FROM floors f CROSS JOIN generate_series(1,3) a(sensor_address)
      LEFT JOIN iot_sensor_latest s ON s.master_id=f.master_id
        AND s.node_address=f.node_address AND s.sensor_address=a.sensor_address
      WHERE f.master_healthy AND f.node_healthy
        AND (s.master_id IS NULL OR NOT s.is_valid OR s.retained
          OR s.last_received_at < now() - make_interval(secs => $1))`, [MAX_AGE_SECONDS]);
    let created = 0;
    for (const sensor of rows) {
      const result = await db.query(`INSERT INTO device_incidents
        (floor_id,master_id,node_address,sensor_address,reason,device_type)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
      [sensor.floor_id, sensor.master_id, sensor.node_address, sensor.sensor_address, sensor.reason, sensor.device_type]);
      const incident = result.rows[0];
      if (!incident) continue;
      const location = deviceLabel(incident);
      await db.query(`INSERT INTO notifications
        (user_id,notification_type,title,message,reference_type,reference_id)
        SELECT DISTINCT u.user_id,'DEVICE_ISSUE',$6::text,
          CASE WHEN u.role_id=3 THEN $2 ELSE $3 END,'DEVICE_INCIDENT',$1::integer
        FROM users u WHERE u.status='ACTIVE' AND (u.role_id IN (1,2) OR
          (u.role_id=3 AND EXISTS (
            SELECT 1 FROM cultivation_sessions cs
            JOIN order_items oi ON oi.order_item_id=cs.order_item_id
            JOIN orders o ON o.order_id=oi.order_id
            JOIN cultivation_session_trays st ON st.session_id=cs.session_id AND st.status='ACTIVE'
            JOIN cultivation_trays t ON t.tray_id=st.tray_id
            JOIN cultivation_floors f ON f.floor_id=t.floor_id
            WHERE o.user_id=u.user_id AND
              (($4::integer IS NOT NULL AND t.floor_id=$4) OR
                ($4::integer IS NULL AND f.master_id=$5 AND f.status='ACTIVE'))
              AND cs.status IN ('PENDING','SPAWN_RESTING','MYCELIAL_DEVELOPMENT',
                'READY_FOR_CULTIVATION','CULTIVATING','HARVEST_READY','HARVESTING')
          )))`, [incident.incident_id,
        `${location} đang gặp vấn đề. Nhân viên đã được thông báo và sẽ kiểm tra, sửa chữa ngay.`,
        `${location} gặp lỗi ${sensor.reason}. Farm Operator cần kiểm tra, sửa chữa. Hệ thống sẽ tự động xác nhận khi thiết bị phục hồi.`,
        sensor.floor_id, sensor.master_id, `${deviceName(incident)} đang gặp vấn đề`]);
      created++;
    }
    return { created };
  });
}

async function resolve(userId, notificationId, note) {
  return transaction(async (db) => {
    const { rows } = await db.query(`SELECT i.* FROM device_incidents i
      JOIN notifications n ON n.reference_type='DEVICE_INCIDENT' AND n.reference_id=i.incident_id
      JOIN users u ON u.user_id=n.user_id
      WHERE n.notification_id=$1 AND n.user_id=$2 AND u.role_id=2 AND u.status='ACTIVE'
      FOR UPDATE OF i`, [notificationId, userId]);
    const incident = rows[0];
    if (!incident) throw new AppError('Device incident notification not found', 404);
    if (incident.status === 'RESOLVED') return incident;
    // Legacy clients use the same automatic recovery; no manual repair is recorded.
    await recover(db);
    const recovered = (await db.query('SELECT * FROM device_incidents WHERE incident_id=$1', [incident.incident_id])).rows[0];
    if (recovered.status !== 'RESOLVED') throw new AppError('Device has no fresh recovery evidence. Recovery is confirmed automatically.', 409);
    return recovered;
  });
}

async function details(userId, ids) {
  const { rows } = await pool.query(`SELECT i.*,
    false AS can_confirm_repair
    FROM device_incidents i CROSS JOIN users u
    WHERE u.user_id=$1 AND i.incident_id=ANY($2::integer[])
      AND EXISTS (SELECT 1 FROM notifications n WHERE n.user_id=u.user_id
        AND n.reference_type='DEVICE_INCIDENT' AND n.reference_id=i.incident_id)`, [userId, ids]);
  return rows;
}

module.exports = { scan, resolve, details };
