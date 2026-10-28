const pool = require('../config/db');
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const trace = require('../utils/iot-trace');

async function transaction(work, diagnostics) {
  const started = performance.now();
  const log = (event, fields) => {
    if (diagnostics) trace(diagnostics.logger, event, { ...diagnostics.context, ...fields });
  };
  if (diagnostics) log('ssr.db.pool.wait', { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });
  const inherited = require('./autoMisting.model').currentConnection();
  const client = inherited || await pool.connect();
  log('ssr.db.pool.acquired', { poolWaitMs: performance.now() - started });
  const db = diagnostics ? { query: async (sql, values) => {
    const queryStarted = performance.now();
    const operation = sql.includes('FOR UPDATE') ? 'master_lock' : sql.trim().split(/\s+/)[0];
    log('ssr.db.query.start', { operation });
    const result = await client.query(sql, values);
    log('ssr.db.query.done', { operation, durationMs: performance.now() - queryStarted });
    return result;
  } } : client;
  try {
    await db.query('BEGIN');
    const result = await work(db);
    await db.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { if (!inherited) client.release(); }
}

const masterColumns = `id, master_identifier AS "masterId", cultivation_room_id AS "cultivationRoomId",
  light_ssr_channel, reported_status AS "reportedStatus", last_seen_at AS "lastSeenAt",
  status_received_at AS "statusReceivedAt", status_retained AS "statusRetained"`;
const sensorColumns = `node_address AS "nodeId", sensor_address AS "sensorId", temperature, humidity,
  is_valid AS ok, last_received_at AS "lastReceivedAt", last_valid_at AS "lastValidAt", retained,
  NULL::timestamptz AS "measuredAt"`;
const commandColumns = `c.id AS "commandId", m.master_identifier AS "masterId", c.channel, c.action, c.status,
  c.requested_by AS "requestedBy", c.requested_at AS "requestedAt", c.expires_at AS "expiresAt",
  c.published_at AS "publishedAt", c.completed_at AS "completedAt", c.error_message AS "errorMessage"`;

async function findMasters() {
  return (await pool.query(`SELECT ${masterColumns} FROM iot_masters ORDER BY master_identifier`)).rows;
}
async function findMaster(identifier) {
  return (await (require('./autoMisting.model').currentConnection() || pool).query(`SELECT ${masterColumns} FROM iot_masters WHERE master_identifier=$1`, [identifier])).rows[0];
}
async function setLightChannel(id, channel) {
  const result = await pool.query(`UPDATE iot_masters SET light_ssr_channel=$2, updated_at=now()
    WHERE id=$1 RETURNING ${masterColumns}`, [id, channel]);
  return result.rows[0];
}
async function findSensors(id) {
  return (await pool.query(`SELECT ${sensorColumns} FROM iot_sensor_latest WHERE master_id=$1
    ORDER BY node_address, sensor_address`, [id])).rows;
}
async function findSensor(id, node, sensor) {
  return (await pool.query(`SELECT ${sensorColumns} FROM iot_sensor_latest
    WHERE master_id=$1 AND node_address=$2 AND sensor_address=$3`, [id, node, sensor])).rows[0];
}
async function history(id, node, sensor, { from, to, limit, offset }) {
  return (await pool.query(`SELECT id, temperature, humidity, is_valid AS ok,
    received_at AS "receivedAt", measured_at AS "measuredAt", retained FROM iot_sensor_readings
    WHERE master_id=$1 AND node_address=$2 AND sensor_address=$3
      AND ($4::timestamptz IS NULL OR received_at >= $4)
      AND ($5::timestamptz IS NULL OR received_at <= $5)
    ORDER BY received_at DESC, id DESC LIMIT $6 OFFSET $7`, [id, node, sensor, from, to, limit, offset])).rows;
}
async function findSsr(id) {
  return (await pool.query(`SELECT n.channel, s.desired_state AS "desiredState", s.reported_state AS "reportedState",
    s.command_requested_at AS "lastCommandAt", s.state_reported_at AS "lastReportedAt",
    s.reported_retained AS "reportedRetained",
    (s.desired_state = s.reported_state) AS "statesMatch"
    FROM generate_series(1,8) AS n(channel)
    LEFT JOIN iot_ssr_states s ON s.master_id=$1 AND s.channel=n.channel ORDER BY n.channel`, [id])).rows;
}

// Serialize transactions per master across ingestion lanes. Timestamp guards below
// preserve latest values when SSR overtakes telemetry; last_seen_at uses GREATEST.
async function receive(message, receivedAt, retained, diagnostics) {
  if (message.type === 'sensor') {
    // One atomic statement instead of six sequential database round trips per
    // reading. Preserve every history sample and the original MQTT arrival time.
    const db = require('./autoMisting.model').currentConnection() || pool;
    const result = await db.query(`WITH master AS (
      UPDATE iot_masters SET last_seen_at=CASE WHEN $8::boolean THEN last_seen_at
        ELSE GREATEST(last_seen_at,$7::timestamptz) END, updated_at=now()
      WHERE master_identifier=$1 RETURNING id
    ), reading AS (
      INSERT INTO iot_sensor_readings(master_id,node_address,sensor_address,temperature,humidity,is_valid,received_at,retained)
      SELECT id,$2,$3,$4,$5,$6,$7,$8 FROM master
      RETURNING master_id,node_address,sensor_address,temperature,humidity,is_valid,received_at,retained
    ), latest AS (
      INSERT INTO iot_sensor_latest(master_id,node_address,sensor_address,temperature,humidity,is_valid,last_received_at,last_valid_at,retained)
      SELECT master_id,node_address,sensor_address,temperature,humidity,is_valid,received_at,
        CASE WHEN is_valid THEN received_at ELSE NULL END,retained FROM reading
      ON CONFLICT (master_id,node_address,sensor_address) DO UPDATE SET
        temperature=CASE WHEN EXCLUDED.is_valid THEN EXCLUDED.temperature ELSE iot_sensor_latest.temperature END,
        humidity=CASE WHEN EXCLUDED.is_valid THEN EXCLUDED.humidity ELSE iot_sensor_latest.humidity END,
        is_valid=EXCLUDED.is_valid, last_received_at=EXCLUDED.last_received_at,
        last_valid_at=COALESCE(EXCLUDED.last_valid_at,iot_sensor_latest.last_valid_at), retained=EXCLUDED.retained
      WHERE iot_sensor_latest.last_received_at <= EXCLUDED.last_received_at
      RETURNING master_id
    ) SELECT id FROM master`,
    [message.master, message.node, message.sensor, message.temperature, message.humidity, message.ok, receivedAt, retained]);
    return result.rows.length > 0;
  }
  return transaction(async (db) => {
    const master = (await db.query('SELECT id FROM iot_masters WHERE master_identifier=$1 FOR UPDATE', [message.master])).rows[0];
    if (!master) return false; // Devices are provisioned explicitly, never by untrusted MQTT traffic.
    await db.query(`UPDATE iot_masters SET last_seen_at=CASE WHEN $3 THEN last_seen_at
      ELSE GREATEST(last_seen_at,$2) END, updated_at=now() WHERE id=$1`, [master.id, receivedAt, retained]);
    if (message.type === 'status') {
      await db.query(`UPDATE iot_masters SET reported_status=$2, status_received_at=$3, status_retained=$4
        WHERE id=$1 AND (status_received_at IS NULL OR status_received_at <= $3)`,
      [master.id, message.status, receivedAt, retained]);
    } else if (message.type === 'ssr') {
      await db.query(`INSERT INTO iot_ssr_states(master_id,channel,reported_state,state_reported_at,reported_retained)
        VALUES ($1,$2,$3,$4,$5) ON CONFLICT (master_id,channel) DO UPDATE SET
        reported_state=EXCLUDED.reported_state, state_reported_at=EXCLUDED.state_reported_at,
        reported_retained=EXCLUDED.reported_retained, updated_at=now()
        WHERE iot_ssr_states.state_reported_at IS NULL OR iot_ssr_states.state_reported_at <= EXCLUDED.state_reported_at`,
      [master.id, message.channel, message.state, receivedAt, retained]);
    }
    return true;
  }, diagnostics);
}

async function createCommand(master, channel, action, userId) {
  // SSR command/feedback timestamps share the backend clock. Command lifecycle
  // timestamps and expiry stay on the DB clock; publication deadlines are monotonic.
  const requestedAt = new Date();
  return transaction(async (db) => {
    const result = await db.query(`INSERT INTO iot_device_commands(id,master_id,channel,action,status,requested_by,expires_at)
      VALUES ($1,$2,$3,$4,'PENDING',$5,now()+interval '5 seconds') RETURNING id, requested_at, expires_at`,
    [randomUUID(), master.id, channel, action, userId]);
    const command = result.rows[0];
    await db.query(`INSERT INTO iot_ssr_states(master_id,channel,desired_state,command_requested_at)
      VALUES ($1,$2,$3,$4) ON CONFLICT (master_id,channel) DO UPDATE SET desired_state=EXCLUDED.desired_state,
      command_requested_at=EXCLUDED.command_requested_at,updated_at=now()
      WHERE iot_ssr_states.command_requested_at IS NULL OR iot_ssr_states.command_requested_at <= EXCLUDED.command_requested_at`,
    [master.id, channel, action, requestedAt]);
    return { commandId: command.id, expiresAt: command.expires_at };
  });
}
async function finishCommand(id, status, error = null) {
  await (require('./autoMisting.model').currentConnection() || pool).query(`UPDATE iot_device_commands SET status=$2::varchar,
    published_at=CASE WHEN $2::varchar='PUBLISHED' THEN now() ELSE NULL END, completed_at=now(), error_message=$3
    WHERE id=$1 AND status='PENDING'`, [id, status, error]);
}
async function expireCommands() {
  await (require('./autoMisting.model').currentConnection() || pool).query(`UPDATE iot_device_commands SET status='TIMED_OUT', completed_at=now(),
    error_message='Đã quá hạn gửi lệnh; có thể chưa xác định được trạng thái chuyển lệnh'
    WHERE status='PENDING' AND expires_at < now()`);
}
async function findCommand(id) {
  await expireCommands();
  return (await (require('./autoMisting.model').currentConnection() || pool).query(`SELECT ${commandColumns} FROM iot_device_commands c
    JOIN iot_masters m ON m.id=c.master_id WHERE c.id=$1`, [id])).rows[0];
}

module.exports = { setLightChannel, findMasters, findMaster, findSensors, findSensor, history, findSsr,
  receive, createCommand, finishCommand, findCommand, expireCommands };
