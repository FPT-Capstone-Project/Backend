const pool = require('../config/db');
const AppError = require('../utils/app-error');

const sessionFrom = `
  FROM cultivation_sessions s
  INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
  INNER JOIN orders o ON o.order_id = oi.order_id
  INNER JOIN users u ON u.user_id = o.user_id
  INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
  LEFT JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
  LEFT JOIN LATERAL (
    SELECT current_stage, progress_percent, condition, description, updated_at
    FROM cultivation_progress
    WHERE session_id = s.session_id
    ORDER BY progress_id DESC
    LIMIT 1
  ) progress ON TRUE
`;

const sessionFields = `
  s.session_id, s.order_item_id, o.order_id, o.user_id,
  u.full_name AS customer_name, u.email AS customer_email,
  s.mushroom_type_id, mt.name AS mushroom_name,
  oi.rental_package_id AS package_id, rp.package_name,
  oi.quantity AS tray_quantity, COALESCE((SELECT it.quantity::int FROM inventory_transactions it
             WHERE it.session_id = s.session_id AND it.transaction_type = 'OUT'
             ORDER BY it.transaction_id LIMIT 1), oi.quantity * 2) AS spawn_quantity,
  s.start_at, s.end_at, s.duration_days, s.harvest_date, s.status, s.harvest_status,
  s.protocol_id, progress.current_stage, progress.progress_percent,
  progress.current_stage AS growth_status,
  s.harvest_ready_at, s.harvest_ready_by,
  progress.condition, progress.description AS notes,
  (s.status = 'HARVEST_READY' OR s.harvest_status = 'HARVEST_READY') AS harvest_ready,
  progress.updated_at AS progress_updated_at
`;

function buildFilters(filters = {}) {
  const clauses = [];
  const values = [];
  const add = (column, value) => {
    if (value === undefined) return;
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  };

  add('s.status', filters.status);
  add('o.user_id', filters.userId);
  add('s.mushroom_type_id', filters.mushroomTypeId);
  if (filters.trayId !== undefined) {
    values.push(filters.trayId);
    clauses.push(`EXISTS (
      SELECT 1
      FROM cultivation_session_trays st
      WHERE st.session_id = s.session_id AND st.tray_id = $${values.length}
    )`);
  }
  if (filters.startDateFrom !== undefined) {
    values.push(filters.startDateFrom);
    clauses.push(`s.start_at >= $${values.length}::timestamptz`);
  }
  if (filters.startDateTo !== undefined) {
    values.push(filters.startDateTo);
    clauses.push(`s.start_at <= $${values.length}::timestamptz`);
  }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

function trayListQuery() {
  return `COALESCE((
    SELECT json_agg(json_build_object(
      'session_tray_id', st.session_tray_id,
      'tray_id', t.tray_id,
      'tray_code', t.tray_code,
      'tray_name', t.tray_name,
      'room_id', cr.room_id,
      'room_name', cr.room_name,
      'floor_id', cf.floor_id,
      'floor_name', cf.floor_name,
      'assignment_status', st.status,
      'assigned_at', st.assigned_at
    ) ORDER BY t.tray_code)
    FROM cultivation_session_trays st
    INNER JOIN cultivation_trays t ON t.tray_id = st.tray_id
    INNER JOIN cultivation_rooms cr ON cr.room_id = t.room_id
    LEFT JOIN cultivation_floors cf ON cf.floor_id = t.floor_id
    WHERE st.session_id = s.session_id
  ), '[]'::json) AS trays`;
}

function assignableTrayWhere(floorAlias = 'f') {
  return `t.status = 'AVAILABLE'
    AND ${floorAlias}.status = 'ACTIVE'
    AND t.room_id = ${floorAlias}.room_id
    AND EXISTS (
      SELECT 1 FROM tray_positions p WHERE p.position_id = t.position_id
        AND p.floor_id = t.floor_id AND p.room_id = t.room_id AND p.status = 'ACTIVE'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM cultivation_session_trays st
      WHERE st.tray_id = t.tray_id AND st.status = 'ACTIVE'
    )`;
}

async function findAllForAdmin(filters = {}) {
  const { where, values } = buildFilters(filters);
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total ${sessionFrom} ${where}`,
    values,
  );
  const pageValues = [...values, filters.limit, filters.offset];
  const result = await pool.query(
    `SELECT ${sessionFields}, ${trayListQuery()}
     ${sessionFrom}
     ${where}
     ORDER BY s.created_at DESC, s.session_id DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return {
    sessions: result.rows,
    total: Number(countResult.rows[0]?.total || 0),
  };
}

async function findByIdForAdmin(sessionId) {
  const result = await pool.query(
    `SELECT ${sessionFields}, ${trayListQuery()}
     ${sessionFrom}
     WHERE s.session_id = $1
     LIMIT 1`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function findAvailableTraysForAdmin(floorId) {
  const values = [];
  let floorFilter = '';
  if (floorId !== undefined) {
    values.push(floorId);
    floorFilter = `AND cf.floor_id = $${values.length}`;
  }
  const result = await pool.query(
    `SELECT t.tray_id, t.tray_code, t.tray_name, t.room_id, t.floor_id,
            t.status, cr.room_name, cf.floor_name, cf.floor_number,
            t.position_id, p.row_number, p.column_number
     FROM cultivation_trays t
     INNER JOIN cultivation_floors cf ON cf.floor_id = t.floor_id
     INNER JOIN cultivation_rooms cr ON cr.room_id = t.room_id
     INNER JOIN tray_positions p ON p.position_id = t.position_id
     WHERE ${assignableTrayWhere('cf')}
       ${floorFilter}
     ORDER BY cr.room_name, cf.floor_number, t.tray_code, t.tray_id`,
    values,
  );
  return result.rows;
}

async function findProgressForAdmin(sessionId) {
  const result = await pool.query(
    `SELECT progress_id, session_id, current_stage, progress_percent,
            start_date, expected_harvest_date, condition, description, updated_at
     FROM cultivation_progress
     WHERE session_id = $1
     ORDER BY progress_id ASC`,
    [sessionId],
  );
  return result.rows;
}

async function findDailyInspectionHistoryForAdmin(sessionId, { limit, offset }) {
  const sessionResult = await pool.query(
    `SELECT session_id AS "sessionId", start_at AS "startAt", end_at AS "endAt",
            status
     FROM cultivation_sessions
     WHERE session_id = $1`,
    [sessionId],
  );
  const session = sessionResult.rows[0];
  if (!session) return null;

  const [count, inspections] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM cultivation_inspections i
       INNER JOIN cultivation_session_trays st ON st.session_tray_id = i.session_tray_id
       WHERE st.session_id = $1`,
      [sessionId],
    ),
    pool.query(
      `SELECT i.inspection_id AS "inspectionId",
              i.session_tray_id AS "sessionTrayId", st.tray_id AS "trayId",
              t.tray_code AS "trayCode", t.tray_name AS "trayName",
              st.status AS "assignmentStatus",
              i.inspection_date AS "inspectionDate",
              progress.current_stage AS "growthStage",
              progress.progress_percent AS "growthProgress",
              i.tray_condition AS "trayCondition",
              i.mushroom_condition AS "mushroomCondition",
              i.notes, i.inspected_by AS "inspectedBy",
              u.full_name AS "inspectedByName",
              COALESCE((
                SELECT json_agg(json_build_object(
                  'imageId', img.image_id,
                  'imageUrl', img.image_url,
                  'caption', img.caption,
                  'uploadedAt', img.uploaded_at
                ) ORDER BY img.uploaded_at, img.image_id)
                FROM cultivation_inspection_images img
                WHERE img.inspection_id = i.inspection_id
              ), '[]'::json) AS images
       FROM cultivation_inspections i
       INNER JOIN cultivation_session_trays st ON st.session_tray_id = i.session_tray_id
       INNER JOIN cultivation_trays t ON t.tray_id = st.tray_id
       INNER JOIN users u ON u.user_id = i.inspected_by
       LEFT JOIN LATERAL (
         SELECT cp.current_stage, cp.progress_percent
         FROM cultivation_progress cp
         WHERE cp.session_id = st.session_id
           AND cp.updated_at <= i.inspection_date
         ORDER BY cp.updated_at DESC, cp.progress_id DESC
         LIMIT 1
       ) progress ON TRUE
       WHERE st.session_id = $1
       ORDER BY i.inspection_date DESC, i.inspection_id DESC
       LIMIT $2 OFFSET $3`,
      [sessionId, limit, offset],
    ),
  ]);
  return { session, inspections: inspections.rows, total: count.rows[0].total };
}

async function findDailyInspectionHistoryForTray(sessionId, sessionTrayId, { limit, offset }) {
  const assignmentResult = await pool.query(
    `SELECT st.session_tray_id AS "sessionTrayId", st.session_id AS "sessionId",
            st.tray_id AS "trayId", st.status AS "assignmentStatus",
            t.tray_code AS "trayCode", t.tray_name AS "trayName"
     FROM cultivation_session_trays st
     INNER JOIN cultivation_trays t ON t.tray_id = st.tray_id
     WHERE st.session_id = $1 AND st.session_tray_id = $2`,
    [sessionId, sessionTrayId],
  );
  const tray = assignmentResult.rows[0];
  if (!tray) return null;

  const [count, inspections] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total
       FROM cultivation_inspections
       WHERE session_tray_id = $1`,
      [sessionTrayId],
    ),
    pool.query(
      `SELECT i.inspection_id AS "inspectionId",
              i.session_tray_id AS "sessionTrayId",
              i.inspection_date AS "inspectionDate",
              progress.current_stage AS "growthStage",
              progress.progress_percent AS "growthProgress",
              i.tray_condition AS "trayCondition",
              i.mushroom_condition AS "mushroomCondition",
              i.notes, i.inspected_by AS "inspectedBy",
              u.full_name AS "inspectedByName",
              COALESCE((
                SELECT json_agg(json_build_object(
                  'imageId', img.image_id,
                  'imageUrl', img.image_url,
                  'caption', img.caption,
                  'uploadedAt', img.uploaded_at
                ) ORDER BY img.uploaded_at, img.image_id)
                FROM cultivation_inspection_images img
                WHERE img.inspection_id = i.inspection_id
              ), '[]'::json) AS images
       FROM cultivation_inspections i
       INNER JOIN users u ON u.user_id = i.inspected_by
       INNER JOIN cultivation_session_trays st ON st.session_tray_id = i.session_tray_id
       LEFT JOIN LATERAL (
         SELECT cp.current_stage, cp.progress_percent
         FROM cultivation_progress cp
         WHERE cp.session_id = st.session_id
           AND cp.updated_at <= i.inspection_date
         ORDER BY cp.updated_at DESC, cp.progress_id DESC
         LIMIT 1
       ) progress ON TRUE
       WHERE i.session_tray_id = $1
       ORDER BY i.inspection_date DESC, i.inspection_id DESC
       LIMIT $2 OFFSET $3`,
      [sessionTrayId, limit, offset],
    ),
  ]);
  return { tray, inspections: inspections.rows, total: count.rows[0].total };
}

async function lockSession(client, sessionId) {
  const result = await client.query(
    `SELECT s.session_id, s.order_item_id, s.mushroom_type_id,
            s.start_at, s.harvest_date::text AS harvest_date, s.duration_days, s.status, s.harvest_status,
            oi.order_id, oi.quantity AS tray_quantity, o.user_id, o.status AS order_status,
            o.payment_status
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE s.session_id = $1
     FOR UPDATE OF s, o`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function lockFloor(client, floorId) {
  const result = await client.query(
    `SELECT floor_id, floor_name, status, room_id
     FROM cultivation_floors
     WHERE floor_id = $1
     FOR UPDATE`,
    [floorId],
  );
  return result.rows[0] || null;
}

async function lockLatestProgress(client, sessionId) {
  const result = await client.query(
    `SELECT progress_id, current_stage, progress_percent, condition
     FROM cultivation_progress
     WHERE session_id = $1
     ORDER BY progress_id DESC
     LIMIT 1
     FOR UPDATE`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function assignTraysForAdmin(sessionId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404, 'SESSION_NOT_FOUND');
    if (session.status !== 'READY_FOR_CULTIVATION') {
      throw new AppError('Session must be ready for cultivation before trays can be assigned', 409, 'INVALID_SESSION_STATUS');
    }

    const requiredTrayQuantity = Number(session.tray_quantity);
    if (!Number.isSafeInteger(requiredTrayQuantity) || requiredTrayQuantity < 1) {
      throw new AppError('Cultivation session has an invalid required tray quantity', 409);
    }
    if (data.trayIds.length !== requiredTrayQuantity) {
      throw new AppError(
        `Exactly ${requiredTrayQuantity} trays must be selected for this cultivation session`,
        409,
        'INVALID_TRAY_QUANTITY',
      );
    }
    const activeAssignments = await client.query(
      `SELECT session_tray_id, tray_id
       FROM cultivation_session_trays
       WHERE session_id = $1 AND status = 'ACTIVE'
       FOR UPDATE`,
      [sessionId],
    );
    if (activeAssignments.rows.length > 0) {
      throw new AppError('Trays are already assigned to this cultivation session', 409, 'TRAYS_ALREADY_ASSIGNED');
    }

    const floorId = data.floorId;
    const floor = await lockFloor(client, floorId);
    if (!floor) throw new AppError('Cultivation floor not found', 404, 'FLOOR_NOT_FOUND');
    if (floor.status !== 'ACTIVE') {
      throw new AppError('Cultivation floor is not active', 409, 'FLOOR_NOT_ACTIVE');
    }
    const selectedTrays = await client.query(
      `SELECT t.tray_id, t.tray_code, t.tray_name, t.floor_id, t.status, t.room_id, t.position_id
       FROM cultivation_trays t
       WHERE t.tray_id = ANY($1::integer[])
       ORDER BY t.tray_id
       FOR UPDATE OF t`,
      [data.trayIds],
    );
    if (selectedTrays.rows.length !== data.trayIds.length) {
      throw new AppError('One or more selected cultivation trays were not found', 404, 'TRAY_NOT_FOUND');
    }
    if (selectedTrays.rows.some((tray) => Number(tray.floor_id) !== floorId)) {
      throw new AppError('All selected trays must belong to the selected cultivation floor', 409, 'TRAY_FLOOR_MISMATCH');
    }
    if (selectedTrays.rows.some((tray) => tray.status !== 'AVAILABLE')) {
      throw new AppError('One or more selected cultivation trays are unavailable', 409, 'TRAY_UNAVAILABLE');
    }
    const positions = await client.query(
      `SELECT position_id, floor_id, room_id, status, row_number, column_number
       FROM tray_positions WHERE position_id = ANY($1::integer[])
       ORDER BY position_id FOR SHARE`,
      [selectedTrays.rows.map(tray => tray.position_id).filter(id => id != null)],
    );
    const positionsById = new Map(positions.rows.map(position => [Number(position.position_id), position]));
    if (selectedTrays.rows.some(tray => {
      const position = positionsById.get(Number(tray.position_id));
      return !position || position.status !== 'ACTIVE'
        || Number(position.floor_id) !== floorId
        || Number(position.room_id) !== Number(floor.room_id)
        || Number(tray.room_id) !== Number(floor.room_id);
    })) {
      throw new AppError('Selected trays must have ACTIVE positions in the selected floor and room', 409, 'TRAY_POSITION_UNAVAILABLE');
    }

    const occupiedAssignments = await client.query(
      `SELECT tray_id
       FROM cultivation_session_trays
       WHERE tray_id = ANY($1::integer[]) AND status = 'ACTIVE'
       FOR UPDATE`,
      [data.trayIds],
    );
    if (occupiedAssignments.rows.length > 0) {
      throw new AppError('One or more selected cultivation trays are already assigned', 409, 'TRAY_UNAVAILABLE');
    }

    const occupied = await client.query(
      `UPDATE cultivation_trays
       SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP
       WHERE tray_id = ANY($1::integer[]) AND status = 'AVAILABLE'
       RETURNING tray_id`,
      [data.trayIds],
    );
    if (occupied.rows.length !== data.trayIds.length) {
      throw new AppError('One or more selected cultivation trays are unavailable', 409, 'TRAY_UNAVAILABLE');
    }

    const traysById = new Map(selectedTrays.rows.map((tray) => [Number(tray.tray_id), tray]));
    const assignedTrays = [];
    for (const trayId of data.trayIds) {
      const assignment = await client.query(
        `INSERT INTO cultivation_session_trays (session_id, tray_id, status)
         VALUES ($1, $2, 'ACTIVE')
         RETURNING session_tray_id, session_id, tray_id, status, assigned_at`,
        [sessionId, trayId],
      );
      const tray = traysById.get(trayId);
      assignedTrays.push({
        ...assignment.rows[0],
        tray_code: tray.tray_code,
        tray_name: tray.tray_name,
        floor_id: floor.floor_id,
        floor_name: floor.floor_name,
      });
    }

    const started = await client.query(
      `UPDATE cultivation_sessions
       SET status = 'CULTIVATING', start_at = CURRENT_TIMESTAMP,
           harvest_date = CURRENT_DATE + duration_days, harvest_status = 'NOT_READY'
       WHERE session_id = $1
       RETURNING status, start_at, harvest_date, harvest_status`,
      [sessionId],
    );
    await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date, expected_harvest_date, description
       ) VALUES ($1, 'FRUITING_INITIATION', 0, CURRENT_DATE, $2::date, 'Cultivation started after tray assignment')`,
      [sessionId, started.rows[0].harvest_date],
    );
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, reference_type, reference_id
       )
       VALUES ($1, 'CULTIVATION_STATUS', 'Vụ trồng đã bắt đầu',
               'Khay đã được bố trí và quá trình nuôi trồng đang diễn ra.',
               'CULTIVATION_SESSION', $2)`,
      [session.user_id, sessionId],
    );
    await client.query('COMMIT');
    return {
      session_id: sessionId,
      ...started.rows[0],
      floor: { floor_id: floor.floor_id, floor_name: floor.floor_name },
      assigned_trays: assignedTrays,
      required_trays: requiredTrayQuantity,
      assigned_trays_count: assignedTrays.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new AppError('One or more selected cultivation trays are already assigned', 409, 'TRAY_UNAVAILABLE');
    }
    throw error;
  } finally {
    client.release();
  }
}

async function createIncidentForAdmin(sessionId, data, reportedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404, 'SESSION_NOT_FOUND');
    if (!['CULTIVATING', 'HARVEST_READY'].includes(session.status)) {
      throw new AppError('Incidents can only be recorded for a cultivating session', 409, 'INVALID_SESSION_STATUS');
    }

    const assignmentResult = await client.query(
      `SELECT session_tray_id
       FROM cultivation_session_trays
       WHERE session_tray_id = $1 AND session_id = $2 AND status = 'ACTIVE'
       FOR UPDATE`,
      [data.sessionTrayId, sessionId],
    );
    if (!assignmentResult.rows[0]) {
      throw new AppError('Active session tray not found for this cultivation session', 404);
    }
    if (data.inspectionId !== undefined) {
      const inspection = await client.query(
        `SELECT inspection_id
         FROM cultivation_inspections
         WHERE inspection_id = $1 AND session_tray_id = $2
         FOR UPDATE`,
        [data.inspectionId, data.sessionTrayId],
      );
      if (!inspection.rows[0]) {
        throw new AppError('Cultivation inspection not found for this session tray', 404);
      }
    }

    const created = await client.query(
      `INSERT INTO cultivation_issues (
         session_tray_id, inspection_id, reported_by, issue_type, title,
         description, severity, action_taken, next_action
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        data.sessionTrayId,
        data.inspectionId ?? null,
        reportedBy,
        data.incidentType,
        data.title,
        data.description ?? null,
        data.severity ?? null,
        data.actionTaken ?? null,
        data.nextAction ?? null,
      ],
    );
    await client.query('COMMIT');
    return created.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findIncidentsForAdmin(sessionId) {
  const result = await pool.query(
    `SELECT ci.*, st.session_id, st.tray_id, cins.inspection_date
     FROM cultivation_issues ci
     INNER JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN cultivation_inspections cins ON cins.inspection_id = ci.inspection_id
     WHERE st.session_id = $1
     ORDER BY ci.reported_at DESC, ci.issue_id DESC`,
    [sessionId],
  );
  return result.rows;
}

async function findInspectionForImage(inspectionId) {
  const result = await pool.query(
    `SELECT inspection_id
     FROM cultivation_inspections
     WHERE inspection_id = $1
     LIMIT 1`,
    [inspectionId],
  );
  return result.rows[0] || null;
}

async function createInspectionImage(inspectionId, imageUrl, caption) {
  const result = await pool.query(
    `INSERT INTO cultivation_inspection_images (inspection_id, image_url, caption)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [inspectionId, imageUrl, caption ?? null],
  );
  return result.rows[0];
}

async function updateGrowthForAdmin(sessionId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (session.status !== 'CULTIVATING') {
      throw new AppError('Only cultivating sessions can update growth', 409, 'INVALID_SESSION_STATUS');
    }
    const latest = await lockLatestProgress(client, sessionId);
    if (latest && data.progressPercent < Number(latest.progress_percent)) {
      throw new AppError('progressPercent cannot be lower than the latest progress', 409);
    }
    if (latest?.current_stage === 'MATURATION' && data.currentStage !== 'MATURATION') {
      throw new AppError('Mature growth cannot move back to growing', 409);
    }
    if (data.expectedHarvestDate !== undefined
      && String(session.harvest_date instanceof Date ? session.harvest_date.toISOString().slice(0, 10) : session.harvest_date) !== data.expectedHarvestDate) {
      await client.query('UPDATE cultivation_sessions SET harvest_date = $2::date WHERE session_id = $1',
        [sessionId, data.expectedHarvestDate]);
      await client.query(
        `INSERT INTO notifications (user_id, notification_type, title, message, reference_type, reference_id)
         VALUES ($1, 'OPERATOR_MESSAGE', 'Expected harvest date updated', $2, 'CULTIVATION_SESSION', $3)`,
        [session.user_id, 'Expected harvest date changed to ' + data.expectedHarvestDate, sessionId],
      );
      session.harvest_date = data.expectedHarvestDate;
    }
    // A new observation requires a fresh readiness assessment.
    await client.query(
      `UPDATE cultivation_sessions SET harvest_status = 'NOT_READY', harvest_ready_at = NULL,
         harvest_ready_by = NULL WHERE session_id = $1`, [sessionId],
    );
    const result = await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date,
         expected_harvest_date, condition, description
       ) VALUES ($1, $2, $3, $4::timestamptz::date, $5::date, $6, $7)
       RETURNING *`,
      [sessionId, data.currentStage, data.progressPercent, session.start_at,
        session.harvest_date, data.condition, data.notes ?? null],
    );
    if (latest?.current_stage !== data.currentStage) {
      const stageMessages = {
        FRUITING_INITIATION: {
          title: 'Nấm bắt đầu hình thành quả thể',
          message: 'Nấm đã bước sang giai đoạn hình thành quả thể.',
        },
        PINNING: {
          title: 'Nấm bắt đầu ra nụ',
          message: 'Các nụ nấm đang hình thành và phát triển.',
        },
        YOUNG_FRUITING: {
          title: 'Nấm non đang phát triển',
          message: 'Nấm non đang tiếp tục phát triển trong khay của bạn.',
        },
        MATURATION: {
          title: 'Nấm đã bước vào giai đoạn trưởng thành',
          message: 'Trang trại sẽ đánh giá tình trạng nấm trước khi xác nhận có thể thu hoạch.',
        },
      };
      const notification = stageMessages[data.currentStage];
      if (notification) {
        await client.query(
          `INSERT INTO notifications (
             user_id, notification_type, title, message, reference_type, reference_id
           )
           VALUES ($1, 'CULTIVATION_STATUS', $2, $3, 'CULTIVATION_SESSION', $4)`,
          [session.user_id, notification.title, notification.message, sessionId],
        );
      }
    }
    if (session.harvest_status === 'HARVEST_READY') {
      await client.query(
        `INSERT INTO notifications (
           user_id, notification_type, title, message, reference_type, reference_id
         )
         VALUES ($1, 'CULTIVATION_STATUS', 'Đã cập nhật tình trạng thu hoạch',
                 'Nấm hiện chưa đủ điều kiện để thu hoạch. Trang trại sẽ tiếp tục theo dõi.',
                 'CULTIVATION_SESSION', $2)`,
        [session.user_id, sessionId],
      );
    }
    await client.query('COMMIT');
    return { ...result.rows[0], growth_status: data.currentStage,
      status: session.status, harvest_status: 'NOT_READY', harvest_ready: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateHarvestReadinessForAdmin(sessionId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (session.status !== 'CULTIVATING') {
      throw new AppError('Only cultivating sessions can confirm harvest readiness', 409, 'INVALID_SESSION_STATUS');
    }
    const assignments = await client.query(
      `SELECT st.session_tray_id, t.status AS tray_status
       FROM cultivation_session_trays st
       INNER JOIN cultivation_trays t ON t.tray_id = st.tray_id
       WHERE st.session_id = $1 AND st.status = 'ACTIVE'
       FOR UPDATE OF st, t`,
      [sessionId],
    );
    if (Number(session.tray_quantity) < 1 || assignments.rows.length !== Number(session.tray_quantity)
      || assignments.rows.some(tray => tray.tray_status !== 'OCCUPIED')) {
      throw new AppError('All required cultivation trays must be active and occupied', 409, 'TRAYS_NOT_ASSIGNED');
    }
    const latest = await lockLatestProgress(client, sessionId);
    if (!latest || !['FRUITING_INITIATION', 'PINNING', 'YOUNG_FRUITING', 'MATURATION'].includes(latest.current_stage)
      || !latest.condition?.trim()) {
      throw new AppError('Record a valid growth condition before confirming readiness', 409, 'GROWTH_NOT_RECORDED');
    }
    // Maturity uses the existing MATURATION stage; percentage alone never confirms readiness.
    if (data.harvestReady && latest.current_stage !== 'MATURATION') {
      throw new AppError('Cultivation must reach MATURATION before harvest readiness', 409, 'HARVEST_NOT_READY');
    }
    if (data.harvestReady) {
      const issues = await client.query(
        `SELECT ci.issue_id FROM cultivation_issues ci
         INNER JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
         WHERE st.session_id = $1 AND ci.status NOT IN ('RESOLVED', 'CANCELLED')
           AND (ci.issue_type IN ('DISEASE', 'CONTAMINATION', 'QUALITY_FAILURE', 'DAMAGE') OR ci.severity = 'HIGH')
         FOR UPDATE OF ci`, [sessionId],
      );
      if (issues.rows.length) throw new AppError('Resolve quality and severe incidents before harvest readiness', 409, 'UNRESOLVED_QUALITY_ISSUES');
    }
    const result = await client.query(
      `UPDATE cultivation_sessions SET harvest_status = $2::varchar,
         harvest_ready_at = CASE WHEN $2 = 'HARVEST_READY' THEN CURRENT_TIMESTAMP ELSE NULL END,
         harvest_ready_by = CASE WHEN $2 = 'HARVEST_READY' THEN $3::integer ELSE NULL END
       WHERE session_id = $1 RETURNING session_id, status, harvest_status, start_at, harvest_date, harvest_ready_at, harvest_ready_by`,
      [sessionId, data.harvestReady ? 'HARVEST_READY' : 'NOT_READY', data.confirmedBy ?? null],
    );
    await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date,
         expected_harvest_date, condition, description
       ) VALUES ($1, $2, $3, $4::timestamptz::date, $5::date, $6, $7)`,
      [sessionId, latest.current_stage, latest.progress_percent, session.start_at,
        session.harvest_date, latest.condition,
        data.notes ?? (data.harvestReady ? 'Harvest readiness confirmed' : 'Not ready for harvest')],
    );
    if (data.harvestReady && session.harvest_status !== 'HARVEST_READY') {
      await client.query(
        `INSERT INTO notifications (user_id, notification_type, title, message, reference_type, reference_id)
         VALUES ($1, 'OPERATOR_MESSAGE', 'Mushrooms ready for harvest',
           'Please choose pickup at the farm or external delivery.', 'CULTIVATION_SESSION', $2)`,
        [session.user_id, sessionId],
      );
    } else if (!data.harvestReady && session.harvest_status === 'HARVEST_READY') {
      await client.query(
        `INSERT INTO notifications (
           user_id, notification_type, title, message, reference_type, reference_id
         )
         VALUES ($1, 'CULTIVATION_STATUS', 'Đã cập nhật tình trạng thu hoạch',
                 'Nấm hiện chưa đủ điều kiện để thu hoạch. Trang trại sẽ tiếp tục theo dõi.',
                 'CULTIVATION_SESSION', $2)`,
        [session.user_id, sessionId],
      );
    }
    await client.query('COMMIT');
    return { ...result.rows[0], harvest_ready: data.harvestReady };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createInspectionForAdmin(sessionTrayId, data, inspectedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignmentResult = await client.query(
      `SELECT st.session_tray_id, st.session_id, st.status AS assignment_status,
              s.start_at, s.harvest_date, s.status AS session_status
       FROM cultivation_session_trays st
       INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
       WHERE st.session_tray_id = $1
       FOR UPDATE OF st, s`,
      [sessionTrayId],
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) throw new AppError('Cultivation session tray not found', 404);
    if (assignment.assignment_status !== 'ACTIVE') {
      throw new AppError('Only active session trays can be inspected', 409, 'SESSION_TRAY_NOT_ACTIVE');
    }
    if (assignment.session_status !== 'CULTIVATING') {
      throw new AppError(
        'Daily inspections can only be created while the session is CULTIVATING',
        409,
        'INVALID_SESSION_STATUS',
      );
    }

    const existingInspection = await client.query(
      `SELECT inspection_id
       FROM cultivation_inspections
       WHERE session_tray_id = $1
         AND inspection_date >= (
           date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')
           AT TIME ZONE 'Asia/Ho_Chi_Minh'
         )
         AND inspection_date < (
           (date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh') + INTERVAL '1 day')
           AT TIME ZONE 'Asia/Ho_Chi_Minh'
         )
       LIMIT 1`,
      [sessionTrayId],
    );
    if (existingInspection.rows.length > 0) {
      throw new AppError(
        'A daily inspection has already been recorded for this tray today',
        409,
        'DUPLICATE_DAILY_INSPECTION',
      );
    }

    const inspectionResult = await client.query(
      `INSERT INTO cultivation_inspections (
         session_tray_id, inspected_by, tray_condition,
         mushroom_condition, notes
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        sessionTrayId,
        inspectedBy,
        data.trayCondition ?? null,
        data.mushroomCondition ?? null,
        data.notes ?? null,
      ],
    );
    await client.query('COMMIT');
    return {
      inspection: inspectionResult.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateInspectionForAdmin(sessionTrayId, inspectionId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignmentResult = await client.query(
      `SELECT st.session_tray_id
       FROM cultivation_session_trays st
       INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
       WHERE st.session_tray_id = $1
       FOR UPDATE OF st, s`,
      [sessionTrayId],
    );
    if (!assignmentResult.rows[0]) {
      throw new AppError('Cultivation session tray not found', 404);
    }

    const inspectionResult = await client.query(
      `SELECT inspection_id
       FROM cultivation_inspections
       WHERE inspection_id = $1 AND session_tray_id = $2
       FOR UPDATE`,
      [inspectionId, sessionTrayId],
    );
    if (!inspectionResult.rows[0]) {
      throw new AppError('Cultivation inspection not found for this session tray', 404);
    }

    const updated = await client.query(
      `UPDATE cultivation_inspections
       SET tray_condition = $3, mushroom_condition = $4, notes = $5
       WHERE inspection_id = $1 AND session_tray_id = $2
       RETURNING *`,
      [
        inspectionId,
        sessionTrayId,
        data.trayCondition ?? null,
        data.mushroomCondition ?? null,
        data.notes ?? null,
      ],
    );
    await client.query('COMMIT');
    return { inspection: updated.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completeForAdmin(sessionId, note) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (session.status !== 'HARVESTING') {
      throw new AppError('Only harvesting sessions can be completed', 409);
    }

    const harvestResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM harvests h
       INNER JOIN cultivation_session_trays st ON st.session_tray_id = h.session_tray_id
       WHERE st.session_id = $1`,
      [sessionId],
    );
    if (Number(harvestResult.rows[0]?.total || 0) < 1) {
      throw new AppError('At least one harvest is required before completing a session', 409);
    }

    const updatedSessionResult = await client.query(
      `UPDATE cultivation_sessions
       SET status = 'COMPLETED', end_at = CURRENT_TIMESTAMP
       WHERE session_id = $1
       RETURNING session_id, status, end_at`,
      [sessionId],
    );
    const releasedTraysResult = await client.query(
      `UPDATE cultivation_trays t
       SET status = 'AVAILABLE', updated_at = CURRENT_TIMESTAMP
       FROM cultivation_session_trays st
       WHERE st.session_id = $1
         AND st.status = 'ACTIVE'
         AND t.tray_id = st.tray_id
       RETURNING t.tray_id`,
      [sessionId],
    );
    await client.query(
      `UPDATE cultivation_session_trays
       SET status = 'RELEASED', notes = COALESCE($2, notes)
       WHERE session_id = $1 AND status = 'ACTIVE'`,
      [sessionId, note ?? null],
    );
    const remainingResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM cultivation_sessions
       WHERE order_item_id IN (
         SELECT order_item_id FROM order_items WHERE order_id = $1
       )
         AND status IN (
          'PENDING', 'SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT',
          'READY_FOR_CULTIVATION', 'CULTIVATING', 'HARVEST_READY', 'HARVESTING'
         )`,
      [session.order_id],
    );
    let orderStatus = session.order_status;
    if (Number(remainingResult.rows[0]?.total || 0) === 0) {
      const orderResult = await client.query(
        `UPDATE orders
         SET status = 'COMPLETED'
         WHERE order_id = $1 AND status IN ('CONFIRMED', 'PROCESSING')
         RETURNING status`,
        [session.order_id],
      );
      orderStatus = orderResult.rows[0]?.status || orderStatus;
    }
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, reference_type, reference_id
       )
       VALUES ($1, 'CULTIVATION_COMPLETED', 'Đã hoàn tất phiên trồng trọt',
               COALESCE($2, 'Phiên trồng trọt của bạn đã hoàn tất.'),
               'CULTIVATION_SESSION', $3)`,
      [session.user_id, note ?? null, sessionId],
    );

    await client.query('COMMIT');
    return {
      session: updatedSessionResult.rows[0],
      orderStatus,
      releasedTrayCount: releasedTraysResult.rows.length,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelForAdmin(sessionId, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (![
      'PENDING', 'SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT',
      'READY_FOR_CULTIVATION', 'CULTIVATING', 'HARVEST_READY', 'HARVESTING',
    ].includes(session.status)) {
      throw new AppError('Only unfinished cultivation sessions can be cancelled', 409);
    }

    const updatedSessionResult = await client.query(
      `UPDATE cultivation_sessions
       SET status = 'CANCELLED',
           end_at = CASE WHEN CURRENT_TIMESTAMP >= start_at THEN CURRENT_TIMESTAMP ELSE start_at END
       WHERE session_id = $1
       RETURNING session_id, status, end_at`,
      [sessionId],
    );
    const releasedTraysResult = await client.query(
      `UPDATE cultivation_trays t
       SET status = 'AVAILABLE', updated_at = CURRENT_TIMESTAMP
       FROM cultivation_session_trays st
       WHERE st.session_id = $1
         AND st.status = 'ACTIVE'
         AND t.tray_id = st.tray_id
       RETURNING t.tray_id`,
      [sessionId],
    );
    await client.query(
      `UPDATE cultivation_session_trays
       SET status = 'RELEASED', notes = $2
       WHERE session_id = $1 AND status = 'ACTIVE'`,
      [sessionId, reason],
    );
    const orderResult = await client.query(
      `UPDATE orders
       SET status = 'CANCELLED',
           payment_status = CASE WHEN payment_status = 'PAID' THEN 'REFUND_PENDING' ELSE payment_status END
       WHERE order_id = $1
       RETURNING status, payment_status`,
      [session.order_id],
    );
    await client.query(
      `INSERT INTO notifications (
         user_id, notification_type, title, message, reference_type, reference_id
       )
       VALUES ($1, 'CULTIVATION_CANCELLED', 'Phiên trồng trọt đã bị hủy',
               $2, 'CULTIVATION_SESSION', $3)`,
      [session.user_id, reason, sessionId],
    );

    await client.query('COMMIT');
    return {
      session: updatedSessionResult.rows[0],
      order: orderResult.rows[0],
      releasedTrayCount: releasedTraysResult.rows.length,
      refundRequired: session.payment_status === 'PAID',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findSessionRecipient(sessionId) {
  const result = await pool.query(
    `SELECT s.session_id, s.status, o.user_id, u.status AS user_status
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     INNER JOIN users u ON u.user_id = o.user_id
     WHERE s.session_id = $1
     LIMIT 1`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function createSessionNotification({ sessionId, userId, type, title, message, createdBy }) {
  const result = await pool.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, created_by,
       reference_type, reference_id
     )
     VALUES ($1, $2, $3, $4, $5, 'CULTIVATION_SESSION', $6)
     RETURNING notification_id, user_id, notification_type, title, message,
               created_at, reference_type, reference_id`,
    [userId, type, title, message, createdBy, sessionId],
  );
  return result.rows[0] || null;
}

module.exports = {
  findAllForAdmin,
  findByIdForAdmin,
  findAvailableTraysForAdmin,
  findProgressForAdmin,
  findDailyInspectionHistoryForAdmin,
  findDailyInspectionHistoryForTray,
  assignTraysForAdmin,
  createIncidentForAdmin,
  findIncidentsForAdmin,
  findInspectionForImage,
  createInspectionImage,
  updateGrowthForAdmin,
  updateHarvestReadinessForAdmin,
  createInspectionForAdmin,
  updateInspectionForAdmin,
  cancelForAdmin,
  findSessionRecipient,
  createSessionNotification,
};
