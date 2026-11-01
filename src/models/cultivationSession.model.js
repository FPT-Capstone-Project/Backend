const pool = require('../config/db');
const AppError = require('../utils/app-error');

const GROWTH_STAGES = [
  'FRUITING_INITIATION',
  'PINNING',
  'YOUNG_FRUITING',
  'MATURATION',
];

const sessionFrom = `
  FROM cultivation_sessions s
  INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
  INNER JOIN orders o ON o.order_id = oi.order_id
  INNER JOIN users u ON u.user_id = o.user_id
  INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
  LEFT JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
  LEFT JOIN LATERAL (
    SELECT current_stage, progress_percent, updated_at
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
  oi.quantity AS tray_quantity, oi.quantity * 3 AS spawn_quantity,
  s.start_at, s.end_at, s.duration_days, s.harvest_date, s.status, s.harvest_status,
  s.protocol_id, progress.current_stage, progress.progress_percent,
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
    clauses.push(`s.start_at >= $${values.length}::timestamp`);
  }
  if (filters.startDateTo !== undefined) {
    values.push(filters.startDateTo);
    clauses.push(`s.start_at <= $${values.length}::timestamp`);
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

async function findAvailableTraysForAdmin() {
  const result = await pool.query(
    `SELECT t.tray_id, t.tray_code, t.tray_name, t.room_id, t.floor_id,
            cr.room_name, cf.floor_name, cf.floor_number
     FROM cultivation_trays t
     INNER JOIN cultivation_floors cf ON cf.floor_id = t.floor_id
     INNER JOIN cultivation_rooms cr ON cr.room_id = t.room_id
     WHERE ${assignableTrayWhere('cf')}
     ORDER BY cr.room_name, cf.floor_number, t.tray_code, t.tray_id`,
  );
  return result.rows;
}

async function findProgressForAdmin(sessionId) {
  const result = await pool.query(
    `SELECT progress_id, session_id, current_stage, progress_percent,
            start_date, expected_harvest_date, description, updated_at
     FROM cultivation_progress
     WHERE session_id = $1
     ORDER BY progress_id ASC`,
    [sessionId],
  );
  return result.rows;
}

async function lockSession(client, sessionId) {
  const result = await client.query(
    `SELECT s.session_id, s.order_item_id, s.mushroom_type_id,
            s.start_at, s.harvest_date, s.duration_days, s.status, s.harvest_status,
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

async function lockLatestProgress(client, sessionId) {
  const result = await client.query(
    `SELECT progress_id, current_stage, progress_percent
     FROM cultivation_progress
     WHERE session_id = $1
     ORDER BY progress_id DESC
     LIMIT 1
     FOR UPDATE`,
    [sessionId],
  );
  return result.rows[0] || null;
}

function assertProgressMovesForward(previous, stage, percent) {
  if (!GROWTH_STAGES.includes(stage)) {
    throw new AppError(
      `growthStage must be one of: ${GROWTH_STAGES.join(', ')}`,
      409,
      'INVALID_GROWTH_STAGE',
    );
  }
  if (!previous) {
    if (stage !== GROWTH_STAGES[0]) {
      throw new AppError('Cultivation must begin at FRUITING_INITIATION', 409, 'INVALID_GROWTH_STAGE');
    }
    return;
  }
  if (Number(percent) < Number(previous.progress_percent)) {
    throw new AppError('progressPercent cannot be lower than the latest progress', 409);
  }
  const previousIndex = GROWTH_STAGES.indexOf(previous.current_stage);
  const nextIndex = GROWTH_STAGES.indexOf(stage);
  if (previousIndex === -1) {
    if (stage !== GROWTH_STAGES[0]) {
      throw new AppError('Cultivation must begin at FRUITING_INITIATION', 409, 'INVALID_GROWTH_STAGE');
    }
    return;
  }
  if (nextIndex < previousIndex) {
    throw new AppError('growthStage cannot be earlier than the latest stage', 409);
  }
  if (nextIndex > previousIndex + 1) {
    throw new AppError('growthStage must advance one stage at a time', 409, 'INVALID_GROWTH_STAGE');
  }
}

async function assignTraysForAdmin(sessionId) {
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

    const availableTrays = await client.query(
      `SELECT t.tray_id
       FROM cultivation_trays t
       INNER JOIN cultivation_floors f ON f.floor_id = t.floor_id
       WHERE ${assignableTrayWhere()}
       ORDER BY t.tray_id
       LIMIT $1
       FOR UPDATE OF t`,
      [requiredTrayQuantity],
    );
    if (availableTrays.rows.length < requiredTrayQuantity) {
      throw new AppError('Not enough available trays to start cultivation', 409, 'INSUFFICIENT_TRAYS');
    }

    const assignedTrays = [];
    for (const tray of availableTrays.rows) {
      const occupied = await client.query(
        `UPDATE cultivation_trays
         SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP
         WHERE tray_id = $1 AND status = 'AVAILABLE'
         RETURNING tray_id`,
        [tray.tray_id],
      );
      if (!occupied.rows[0]) {
        throw new AppError('A cultivation tray is no longer available', 409, 'INSUFFICIENT_TRAYS');
      }
      const assignment = await client.query(
        `INSERT INTO cultivation_session_trays (session_id, tray_id, status)
         VALUES ($1, $2, 'ACTIVE')
         RETURNING session_tray_id, session_id, tray_id, status, assigned_at`,
        [sessionId, tray.tray_id],
      );
      assignedTrays.push(assignment.rows[0]);
    }

    await client.query('COMMIT');
    return { sessionId, assignedTrays };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function activateForAdmin(sessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404, 'SESSION_NOT_FOUND');
    if (session.status !== 'READY_FOR_CULTIVATION') {
      throw new AppError('Session must be ready for cultivation before activation', 409, 'INVALID_SESSION_STATUS');
    }

    const activeAssignments = await client.query(
      `SELECT session_tray_id
       FROM cultivation_session_trays
       WHERE session_id = $1 AND status = 'ACTIVE'
       FOR UPDATE`,
      [sessionId],
    );
    if (activeAssignments.rows.length !== Number(session.tray_quantity)) {
      throw new AppError('Required cultivation trays have not been assigned', 409, 'TRAYS_NOT_ASSIGNED');
    }

    const updated = await client.query(
      `UPDATE cultivation_sessions
       SET status = 'CULTIVATING',
           start_at = CURRENT_TIMESTAMP,
           harvest_date = CURRENT_DATE + duration_days,
           harvest_status = 'NOT_READY'
       WHERE session_id = $1
       RETURNING session_id, status, start_at, harvest_date, harvest_status`,
      [sessionId],
    );
    await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date,
         expected_harvest_date, description
       )
       VALUES ($1, 'FRUITING_INITIATION', 0, CURRENT_DATE, $2::date, $3)`,
      [sessionId, updated.rows[0].harvest_date, 'Cultivation activated'],
    );

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markHarvestReadyForAdmin(sessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404, 'SESSION_NOT_FOUND');
    if (session.status !== 'CULTIVATING') {
      throw new AppError('Only cultivating sessions can be marked harvest ready', 409, 'INVALID_SESSION_STATUS');
    }
    if (session.harvest_status === 'HARVEST_READY') {
      throw new AppError('Cultivation session is already harvest ready', 409, 'ALREADY_HARVEST_READY');
    }

    const latest = await lockLatestProgress(client, sessionId);
    if (!latest || latest.current_stage !== 'MATURATION') {
      throw new AppError('Cultivation must reach MATURATION before harvest readiness', 409, 'HARVEST_NOT_READY');
    }
    const maturityInspection = await client.query(
      `SELECT ci.inspection_id
       FROM cultivation_inspections ci
       INNER JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
       WHERE st.session_id = $1
         AND st.status = 'ACTIVE'
         AND ci.growth_stage = 'MATURATION'
       ORDER BY ci.inspection_date DESC, ci.inspection_id DESC
       LIMIT 1
       FOR UPDATE OF ci`,
      [sessionId],
    );
    if (!maturityInspection.rows[0]) {
      throw new AppError('A MATURATION inspection is required before harvest readiness', 409, 'HARVEST_NOT_READY');
    }
    const updated = await client.query(
      `UPDATE cultivation_sessions
       SET harvest_status = 'HARVEST_READY'
       WHERE session_id = $1
       RETURNING session_id, status, harvest_status, start_at, harvest_date`,
      [sessionId],
    );
    await client.query('COMMIT');
    return updated.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
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
    if (session.status !== 'CULTIVATING') {
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
    `SELECT ci.*, st.session_id, st.tray_id, cins.inspection_date,
            cins.growth_stage, cins.growth_progress
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

async function createProgressForAdmin(sessionId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (session.status !== 'CULTIVATING') {
      throw new AppError('Only cultivating sessions can record progress', 409, 'INVALID_SESSION_STATUS');
    }

    const latest = await lockLatestProgress(client, sessionId);
    assertProgressMovesForward(latest, data.currentStage, data.progressPercent);
    const result = await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date,
         expected_harvest_date, description
       )
       VALUES ($1, $2, $3, $4::timestamp::date, $5::date, $6)
       RETURNING *`,
      [
        sessionId,
        data.currentStage,
        data.progressPercent,
        session.start_at,
        session.harvest_date,
        data.description ?? null,
      ],
    );
    await client.query('COMMIT');
    return result.rows[0];
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
    if (assignment.assignment_status !== 'ACTIVE' || assignment.session_status !== 'CULTIVATING') {
      throw new AppError('Only active session trays can be inspected', 409);
    }

    const latest = await lockLatestProgress(client, assignment.session_id);
    assertProgressMovesForward(latest, data.growthStage, data.growthProgress);
    const inspectionResult = await client.query(
      `INSERT INTO cultivation_inspections (
         session_tray_id, inspected_by, growth_stage, tray_condition,
         mushroom_condition, growth_progress, notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        sessionTrayId,
        inspectedBy,
        data.growthStage,
        data.trayCondition ?? null,
        data.mushroomCondition ?? null,
        data.growthProgress,
        data.notes ?? null,
      ],
    );
    const progressResult = await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date,
         expected_harvest_date, description
       )
       VALUES ($1, $2, $3, $4::timestamp::date, $5::date, $6)
       RETURNING *`,
      [
        assignment.session_id,
        data.growthStage,
        data.growthProgress,
        assignment.start_at,
        assignment.harvest_date,
        data.notes ?? `Daily tray inspection ${inspectionResult.rows[0].inspection_id}`,
      ],
    );

    await client.query('COMMIT');
    return {
      inspection: inspectionResult.rows[0],
      progress: progressResult.rows[0],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createHarvestForAdmin(sessionTrayId, data, harvestedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const assignmentResult = await client.query(
      `SELECT st.session_tray_id, st.session_id, st.status AS assignment_status,
              s.status AS session_status, s.harvest_status
       FROM cultivation_session_trays st
       INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
       WHERE st.session_tray_id = $1
       FOR UPDATE OF st, s`,
      [sessionTrayId],
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) throw new AppError('Cultivation session tray not found', 404);
    if (assignment.assignment_status !== 'ACTIVE'
      || assignment.session_status !== 'HARVESTING'
      || assignment.harvest_status !== 'HARVEST_READY') {
      throw new AppError('Harvests can only be recorded for a harvesting session tray', 409);
    }

    const latest = await lockLatestProgress(client, assignment.session_id);
    if (!latest || latest.current_stage !== 'MATURATION') {
      throw new AppError('Cultivation progress must reach MATURATION before recording a harvest', 409);
    }

    const result = await client.query(
      `INSERT INTO harvests (
         session_tray_id, harvest_date, harvested_by, total_weight_kg,
         usable_weight_kg, rejected_weight_kg, quality_grade, notes
       )
       VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        sessionTrayId,
        data.harvestDate ?? null,
        harvestedBy,
        data.totalWeightKg,
        data.usableWeightKg,
        data.rejectedWeightKg ?? 0,
        data.qualityGrade ?? null,
        data.notes ?? null,
      ],
    );
    await client.query('COMMIT');
    return result.rows[0];
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
          'READY_FOR_CULTIVATION', 'CULTIVATING', 'HARVESTING'
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
      'READY_FOR_CULTIVATION', 'CULTIVATING', 'HARVESTING',
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
  assignTraysForAdmin,
  activateForAdmin,
  markHarvestReadyForAdmin,
  createIncidentForAdmin,
  findIncidentsForAdmin,
  findInspectionForImage,
  createInspectionImage,
  createProgressForAdmin,
  createInspectionForAdmin,
  createHarvestForAdmin,
  completeForAdmin,
  cancelForAdmin,
  findSessionRecipient,
  createSessionNotification,
};
