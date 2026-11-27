const pool = require('../config/db');

const cameraConfigSelect = `
  SELECT c.camera_id, c.camera_code, c.camera_name, c.status,
         c.room_id, r.room_name, c.floor_id, f.floor_number,
         ac.config_id, ac.capture_times, ac.timezone, ac.is_enabled,
         ac.last_capture_at, ac.next_capture_at, ac.created_at, ac.updated_at
  FROM public.cameras c
  INNER JOIN public.cultivation_rooms r ON r.room_id = c.room_id
  LEFT JOIN public.cultivation_floors f
    ON f.floor_id = c.floor_id AND f.room_id = c.room_id
  LEFT JOIN public.automatic_capture_configs ac ON ac.camera_id = c.camera_id
`;

const captureLogSelect = `
  SELECT l.*, c.camera_code, c.camera_name, c.status AS camera_status,
         c.room_id, r.room_name, c.floor_id, f.floor_number
  FROM public.automatic_capture_logs l
  INNER JOIN public.cameras c ON c.camera_id = l.camera_id
  INNER JOIN public.cultivation_rooms r ON r.room_id = c.room_id
  LEFT JOIN public.cultivation_floors f
    ON f.floor_id = c.floor_id AND f.room_id = c.room_id
`;

async function findCameraById(cameraId) {
  const result = await pool.query(
    `SELECT camera_id, room_id, floor_id, camera_code, camera_name, status
     FROM public.cameras
     WHERE camera_id = $1`,
    [cameraId],
  );
  return result.rows[0] || null;
}

async function findTraysByFloor(floorId, roomId) {
  const result = await pool.query(
    `SELECT t.tray_id, t.tray_code, t.tray_name, t.status AS tray_status,
            t.floor_id, f.floor_number, f.floor_name,
            t.position_id, p.row_number, p.column_number,
            assignment.session_tray_id, assignment.session_id,
            assignment.session_status, assignment.harvest_status
     FROM public.cultivation_trays t
     INNER JOIN public.cultivation_floors f
       ON f.floor_id = t.floor_id AND f.room_id = t.room_id
     LEFT JOIN public.tray_positions p ON p.position_id = t.position_id
     INNER JOIN LATERAL (
       SELECT st.session_tray_id, st.session_id,
              s.status AS session_status, s.harvest_status
       FROM public.cultivation_session_trays st
       INNER JOIN public.cultivation_sessions s ON s.session_id = st.session_id
       WHERE st.tray_id = t.tray_id AND st.status = 'ACTIVE'
       ORDER BY st.session_tray_id DESC
       LIMIT 1
     ) assignment ON TRUE
     WHERE t.floor_id = $1 AND t.room_id = $2
     ORDER BY t.tray_id`,
    [floorId, roomId],
  );
  return result.rows;
}

async function createCaptureLog(cameraId, scheduledAt) {
  const result = await pool.query(
    `INSERT INTO public.automatic_capture_logs (camera_id, scheduled_at)
     VALUES ($1, $2)
     RETURNING log_id`,
    [cameraId, scheduledAt],
  );
  return result.rows[0] || null;
}

async function recordCaptureImage(logId, imageUrl, publicId, capturedAt) {
  const result = await pool.query(
    `UPDATE public.automatic_capture_logs
     SET image_url = $2, public_id = $3, captured_at = $4
     WHERE log_id = $1
     RETURNING log_id`,
    [logId, imageUrl, publicId, capturedAt],
  );
  return result.rows[0] || null;
}

async function findActiveSessionTrays(floorId) {
  const result = await pool.query(
    `SELECT st.session_tray_id, st.tray_id
     FROM public.cultivation_session_trays st
     INNER JOIN public.cultivation_sessions s ON s.session_id = st.session_id
     INNER JOIN public.cultivation_trays t ON t.tray_id = st.tray_id
     WHERE t.floor_id = $1
       AND t.status = 'OCCUPIED'
       AND st.status = 'ACTIVE'
       AND s.status IN ('CULTIVATING', 'HARVEST_READY', 'HARVESTING')
     ORDER BY st.session_tray_id`,
    [floorId],
  );
  return result.rows;
}

async function createCaptureInspection({
  sessionTrayId,
  floorId,
  inspectedBy,
  logId,
  imageUrl,
  capturedAt,
}) {
  const result = await pool.query(
    `WITH eligible_assignment AS (
       SELECT st.session_tray_id
       FROM public.cultivation_session_trays st
       INNER JOIN public.cultivation_sessions s ON s.session_id = st.session_id
       INNER JOIN public.cultivation_trays t ON t.tray_id = st.tray_id
       WHERE st.session_tray_id = $1
         AND st.status = 'ACTIVE'
         AND t.floor_id = $2
         AND t.status = 'OCCUPIED'
         AND s.status IN ('CULTIVATING', 'HARVEST_READY', 'HARVESTING')
     ),
     new_inspection AS (
       INSERT INTO public.cultivation_inspections (
         session_tray_id, inspected_by, inspection_date, source, capture_log_id, captured_at
       )
       SELECT session_tray_id, $3, $6, 'AUTO', $4, $6
       FROM eligible_assignment
       RETURNING inspection_id
     )
     INSERT INTO public.cultivation_inspection_images (inspection_id, image_url)
     SELECT inspection_id, $5
     FROM new_inspection
     RETURNING inspection_id`,
    [sessionTrayId, floorId, inspectedBy, logId, imageUrl, capturedAt],
  );
  return result.rows[0] || null;
}

async function finishCaptureLog(logId, {
  status,
  capturedAt,
  imageUrl,
  publicId,
  totalTrays,
  successTrays,
  failedTrays,
  errorMessage,
}) {
  const result = await pool.query(
    `UPDATE public.automatic_capture_logs
     SET status = $2,
         captured_at = COALESCE($3, captured_at),
         image_url = COALESCE($4, image_url),
         public_id = COALESCE($5, public_id),
         total_trays = $6,
         success_trays = $7,
         failed_trays = $8,
         error_message = $9,
         completed_at = NOW()
     WHERE log_id = $1
     RETURNING log_id`,
    [
      logId,
      status,
      capturedAt ?? null,
      imageUrl ?? null,
      publicId ?? null,
      totalTrays,
      successTrays,
      failedTrays,
      errorMessage ?? null,
    ],
  );
  return result.rows[0] || null;
}

async function findConfigs() {
  const result = await pool.query(
    `${cameraConfigSelect} ORDER BY c.camera_id`,
  );
  return result.rows;
}

async function findConfigByCameraId(cameraId) {
  const result = await pool.query(
    `${cameraConfigSelect} WHERE c.camera_id = $1`,
    [cameraId],
  );
  return result.rows[0] || null;
}

async function upsertConfig(cameraId, captureTimes, isEnabled) {
  const result = await pool.query(
    `INSERT INTO public.automatic_capture_configs
       (camera_id, capture_times, is_enabled)
     SELECT c.camera_id, $2::time[], $3
     FROM public.cameras c
     WHERE c.camera_id = $1 AND c.status = 'ACTIVE'
     ON CONFLICT (camera_id) DO UPDATE
       SET capture_times = EXCLUDED.capture_times,
           is_enabled = EXCLUDED.is_enabled,
           next_capture_at = NULL,
           updated_at = NOW()
     RETURNING config_id`,
    [cameraId, captureTimes, isEnabled],
  );
  return result.rows[0] || null;
}

async function findLogs({ cameraId, status, limit, offset }) {
  const conditions = [];
  const values = [];
  if (cameraId !== undefined) {
    values.push(cameraId);
    conditions.push(`l.camera_id = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    conditions.push(`l.status = $${values.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [countResult, recordsResult] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM public.automatic_capture_logs l
       ${where}`,
      values,
    ),
    pool.query(
      `${captureLogSelect} ${where}
       ORDER BY l.scheduled_at DESC, l.log_id DESC
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
  ]);
  return {
    records: recordsResult.rows,
    total: countResult.rows[0].total,
  };
}

async function findLogById(logId) {
  const result = await pool.query(
    `${captureLogSelect} WHERE l.log_id = $1`,
    [logId],
  );
  return result.rows[0] || null;
}

module.exports = {
  findCameraById,
  findTraysByFloor,
  createCaptureLog,
  recordCaptureImage,
  findActiveSessionTrays,
  createCaptureInspection,
  finishCaptureLog,
  findConfigs,
  findConfigByCameraId,
  upsertConfig,
  findLogs,
  findLogById,
};
