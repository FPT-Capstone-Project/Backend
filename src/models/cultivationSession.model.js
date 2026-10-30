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
  s.start_at, s.end_at, s.duration_days, s.harvest_date, s.status,
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

async function lockSession(client, sessionId) {
  const result = await client.query(
    `SELECT s.session_id, s.order_item_id, s.mushroom_type_id,
            s.start_at, s.harvest_date, s.status,
            oi.order_id, o.user_id, o.status AS order_status,
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
  if (!previous) return;
  if (Number(percent) < Number(previous.progress_percent)) {
    throw new AppError('progressPercent cannot be lower than the latest progress', 409);
  }
  const stageOrder = ['PREPARATION', 'INCUBATION', 'PINNING', 'FRUITING', 'HARVEST'];
  const previousIndex = stageOrder.indexOf(previous.current_stage);
  const nextIndex = stageOrder.indexOf(stage);
  if (previousIndex !== -1 && nextIndex !== -1 && nextIndex < previousIndex) {
    throw new AppError('growthStage cannot be earlier than the latest stage', 409);
  }
}

async function createProgressForAdmin(sessionId, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (session.status !== 'ACTIVE') {
      throw new AppError('Only active cultivation sessions can record progress', 409);
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
    if (assignment.assignment_status !== 'ACTIVE' || assignment.session_status !== 'ACTIVE') {
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
              s.status AS session_status
       FROM cultivation_session_trays st
       INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
       WHERE st.session_tray_id = $1
       FOR UPDATE OF st, s`,
      [sessionTrayId],
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) throw new AppError('Cultivation session tray not found', 404);
    if (assignment.assignment_status !== 'ACTIVE' || assignment.session_status !== 'ACTIVE') {
      throw new AppError('Harvests can only be recorded for an active session tray', 409);
    }

    const latest = await lockLatestProgress(client, assignment.session_id);
    if (!latest || latest.current_stage !== 'HARVEST') {
      throw new AppError('Cultivation progress must be at HARVEST before recording a harvest', 409);
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
    if (session.status !== 'ACTIVE') {
      throw new AppError('Only active cultivation sessions can be completed', 409);
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
         AND status IN ('PLANNED', 'ACTIVE')`,
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
    if (!['PLANNED', 'ACTIVE'].includes(session.status)) {
      throw new AppError('Only planned or active cultivation sessions can be cancelled', 409);
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
  createProgressForAdmin,
  createInspectionForAdmin,
  createHarvestForAdmin,
  completeForAdmin,
  cancelForAdmin,
  findSessionRecipient,
  createSessionNotification,
};
