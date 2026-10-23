const pool = require('../config/db');
const AppError = require('../utils/app-error');

const rentalJoins = `
  FROM rentals r
  INNER JOIN users u ON u.user_id = r.user_id
  INNER JOIN orders o ON o.order_id = r.order_id
  LEFT JOIN LATERAL (
    SELECT rp.package_id, rp.package_name
    FROM order_items oi
    INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
    WHERE oi.order_id = r.order_id AND oi.item_type = 'RENTAL'
    ORDER BY oi.order_item_id
    LIMIT 1
  ) rp ON TRUE
  LEFT JOIN LATERAL (
    SELECT mt.mushroom_type_id, mt.name AS mushroom_name
    FROM order_items oi
    INNER JOIN mushroom_types mt ON mt.mushroom_type_id = oi.mushroom_type_id
    WHERE oi.order_id = r.order_id
    ORDER BY oi.order_item_id
    LIMIT 1
  ) mushroom ON TRUE
  LEFT JOIN cultivation_trays ct ON ct.tray_id = r.tray_id
  LEFT JOIN cultivation_rooms cr ON cr.room_id = ct.room_id
  LEFT JOIN cultivation_floors cf ON cf.floor_id = ct.floor_id
`;

const rentalFields = `
  r.rental_id, r.order_id, r.user_id, u.full_name AS customer_name,
  u.email AS customer_email, u.phone AS customer_phone,
  rp.package_id, rp.package_name, mushroom.mushroom_type_id, mushroom.mushroom_name,
  r.duration_days, r.tray_id,
  ct.tray_code, ct.tray_name, cr.room_id, cr.room_code, cr.room_name,
  cf.floor_id, cf.floor_number, cf.floor_name,
  r.start_date, r.end_date, r.status, o.payment_status,
  r.created_at, r.updated_at
`;

function buildFilters(filters = {}) {
  const conditions = [];
  const values = [];
  const addFilter = (column, value) => {
    if (value === undefined || value === null) return;
    values.push(value);
    conditions.push(`${column} = $${values.length}`);
  };

  addFilter('r.status', filters.status);
  addFilter('r.user_id', filters.userId);
  addFilter('rp.package_id', filters.packageId);
  addFilter('r.tray_id', filters.trayId);

  if (filters.startDateFrom) {
    values.push(filters.startDateFrom);
    conditions.push(`r.start_date >= $${values.length}::timestamp`);
  }
  if (filters.startDateTo) {
    values.push(filters.startDateTo);
    conditions.push(`r.start_date <= $${values.length}::timestamp`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

async function findAllForAdmin(filters = {}) {
  const { where, values } = buildFilters(filters);
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     ${rentalJoins}
     ${where}`,
    values,
  );
  const pageValues = [...values, filters.limit, filters.offset];
  const result = await pool.query(
    `SELECT ${rentalFields}
     ${rentalJoins}
     ${where}
     ORDER BY r.created_at DESC, r.rental_id DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return {
    rentals: result.rows,
    total: Number(countResult.rows[0] && countResult.rows[0].total) || 0,
  };
}

async function findByIdForAdmin(rentalId) {
  const result = await pool.query(
    `SELECT ${rentalFields}
     ${rentalJoins}
     WHERE r.rental_id = $1
     LIMIT 1`,
    [rentalId],
  );
  return result.rows[0] || null;
}

async function writeStatusLog(client, {
  rentalId,
  action,
  fromStatus,
  toStatus,
  performedBy,
  note,
}) {
  const result = await client.query(
    `INSERT INTO rental_status_logs (
       rental_id, action, from_status, to_status, performed_by, note
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [rentalId, action, fromStatus ?? null, toStatus ?? null, performedBy ?? null, note ?? null],
  );
  return result.rows[0] || null;
}

async function insertNotification(client, userId, type, title, message, rentalId = null) {
  const result = await client.query(
    `INSERT INTO notifications (user_id, notification_type, title, message, rental_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [userId, type, title, message, rentalId],
  );
  return result.rows[0] || null;
}

async function lockActiveSession(client, rentalId) {
  const result = await client.query(
    `SELECT session_id, rental_id, tray_id, mushroom_type_id, start_at, end_at,
            duration_days, status, harvest_date
     FROM cultivation_sessions
     WHERE rental_id = $1 AND status = 'ACTIVE'
     ORDER BY session_id DESC
     LIMIT 1
     FOR UPDATE`,
    [rentalId],
  );
  return result.rows[0] || null;
}

async function lockRentalForLifecycle(client, rentalId) {
  const result = await client.query(
    `SELECT r.rental_id, r.order_id, r.user_id, r.tray_id, r.status,
            o.status AS order_status, o.payment_status
     FROM rentals r
     INNER JOIN orders o ON o.order_id = r.order_id
     WHERE r.rental_id = $1
     FOR UPDATE OF r, o`,
    [rentalId],
  );
  return result.rows[0] || null;
}

async function lockTray(client, trayId) {
  const result = await client.query(
    `SELECT tray_id, status
     FROM cultivation_trays
     WHERE tray_id = $1
     FOR UPDATE`,
    [trayId],
  );
  return result.rows[0] || null;
}

async function findLatestProgress(client, sessionId) {
  const result = await client.query(
    `SELECT progress_id, current_stage, progress_percent, start_date,
            expected_harvest_date, description, updated_at
     FROM cultivation_progress
     WHERE session_id = $1
     ORDER BY progress_id DESC
     LIMIT 1
     FOR UPDATE`,
    [sessionId],
  );
  return result.rows[0] || null;
}

function notificationContent(type) {
  const content = {
    RENTAL_APPROVED: {
      title: 'Yêu cầu thuê đã được duyệt',
      message: 'Đơn thuê của bạn đang được chuẩn bị.',
    },
    CULTIVATION_STARTED: {
      title: 'Phiên trồng trọt đã bắt đầu',
      message: 'Nấm của bạn đã được đưa vào khay trồng.',
    },
    HARVEST_RECORDED: {
      title: 'Đã ghi nhận thu hoạch',
      message: 'Một đợt thu hoạch mới đã được ghi nhận.',
    },
    RENTAL_COMPLETED: {
      title: 'Phiên thuê đã hoàn tất',
      message: 'Phiên trồng trọt và thuê của bạn đã hoàn tất.',
    },
    RENTAL_CANCELLED: {
      title: 'Phiên thuê đã bị hủy',
      message: 'Phiên thuê của bạn đã bị hủy.',
    },
  };
  return content[type];
}

async function notifyRentalUser(client, userId, type, rentalId) {
  const content = notificationContent(type);
  return insertNotification(client, userId, type, content.title, content.message, rentalId);
}

async function getHarvestSummary(client, sessionId) {
  const countResult = await client.query(
    `SELECT COUNT(*)::int AS "totalHarvests"
     FROM harvests
     WHERE session_id = $1`,
    [sessionId],
  );
  const totalsResult = await client.query(
    `SELECT unit, COALESCE(SUM(quantity), 0)::numeric AS "totalQuantity"
     FROM harvests
     WHERE session_id = $1
     GROUP BY unit
     ORDER BY unit`,
    [sessionId],
  );
  const countRow = countResult.rows[0] || {};
  return {
    totalHarvests: Number(countRow.totalHarvests ?? countRow.total_harvests ?? 0),
    totals: totalsResult.rows.map((row) => ({
      unit: row.unit,
      totalQuantity: Number(row.totalQuantity ?? row.total_quantity),
    })),
  };
}

async function createFromOrderForAdmin(orderId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `SELECT o.order_id, o.user_id, o.status, o.payment_status,
              rp.duration_days
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.order_id AND oi.item_type = 'RENTAL'
       INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
       WHERE o.order_id = $1
       ORDER BY oi.order_item_id
       LIMIT 1
       FOR UPDATE OF o`,
      [orderId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new AppError('Paid rental order not found', 404);
    if (order.payment_status !== 'PAID') {
      throw new AppError('Only paid orders can be turned into rentals', 409);
    }
    if (order.status === 'CANCELLED') {
      throw new AppError('Cancelled orders cannot be turned into rentals', 409);
    }

    const insertedResult = await client.query(
      `INSERT INTO rentals (order_id, user_id, duration_days)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING rental_id`,
      [order.order_id, order.user_id, order.duration_days],
    );
    const rentalId = insertedResult.rows[0] && insertedResult.rows[0].rental_id;
    if (rentalId) {
      await client.query('COMMIT');
      return { rentalId, created: true };
    }

    const existingResult = await client.query(
      'SELECT rental_id FROM rentals WHERE order_id = $1 LIMIT 1',
      [orderId],
    );
    if (!existingResult.rows[0]) {
      throw new AppError('Unable to create rental from order', 500);
    }

    await client.query('COMMIT');
    return { rentalId: existingResult.rows[0].rental_id, created: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createProgressForAdmin(rentalId, data, performedBy, progressStages) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const rental = await lockRentalForLifecycle(client, rentalId);
    if (!rental) throw new AppError('Rental not found', 404);
    if (rental.status !== 'ACTIVE') {
      throw new AppError('Only active rentals can record cultivation progress', 409);
    }

    const session = await lockActiveSession(client, rentalId);
    if (!session) throw new AppError('Rental has no active cultivation session', 409);
    const tray = await lockTray(client, session.tray_id);
    if (!tray) throw new AppError('Cultivation tray not found', 409);

    const latest = await findLatestProgress(client, session.session_id);
    const stages = Array.isArray(progressStages) ? progressStages : [];
    if (latest && Number(data.progressPercent) < Number(latest.progress_percent)) {
      throw new AppError('progressPercent cannot be lower than the latest progress', 409);
    }
    if (latest) {
      const currentStageIndex = stages.indexOf(data.currentStage);
      const latestStageIndex = stages.indexOf(latest.current_stage);
      if (latestStageIndex !== -1 && currentStageIndex < latestStageIndex) {
        throw new AppError('currentStage cannot be earlier than the latest stage', 409);
      }
    }

    const result = await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date,
         expected_harvest_date, description
       )
       VALUES ($1, $2, $3, $4::timestamp::date, $5::date, $6)
       RETURNING *`,
      [
        session.session_id,
        data.currentStage,
        data.progressPercent,
        session.start_at,
        session.harvest_date,
        data.description ?? null,
      ],
    );
    const progress = result.rows[0];
    await client.query('COMMIT');
    return { ...progress, rentalId, sessionId: session.session_id };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

async function createHarvestForAdmin(rentalId, data, performedBy) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const rental = await lockRentalForLifecycle(client, rentalId);
    if (!rental) throw new AppError('Rental not found', 404);
    if (rental.status !== 'ACTIVE') {
      throw new AppError('Only active rentals can record harvests', 409);
    }

    const session = await lockActiveSession(client, rentalId);
    if (!session) throw new AppError('Rental has no active cultivation session', 409);
    const tray = await lockTray(client, session.tray_id);
    if (!tray) throw new AppError('Cultivation tray not found', 409);

    const latest = await findLatestProgress(client, session.session_id);
    if (!latest || latest.current_stage !== 'HARVEST') {
      throw new AppError('Cultivation progress must be at HARVEST before recording a harvest', 409);
    }
    if (data.harvestDate && data.harvestDate < dateOnly(session.start_at)) {
      throw new AppError('harvestDate cannot be before the cultivation session start date', 400);
    }

    const harvestResult = data.harvestDate === undefined
      ? await client.query(
        `INSERT INTO harvests (session_id, harvest_date, quantity, unit, quality_grade, notes)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5)
         RETURNING *`,
        [
          session.session_id,
          data.quantity,
          data.unit,
          data.qualityGrade ?? null,
          data.notes ?? null,
        ],
      )
      : await client.query(
        `INSERT INTO harvests (session_id, harvest_date, quantity, unit, quality_grade, notes)
         VALUES ($1, $2::date, $3, $4, $5, $6)
         RETURNING *`,
        [
          session.session_id,
          data.harvestDate,
          data.quantity,
          data.unit,
          data.qualityGrade ?? null,
          data.notes ?? null,
        ],
      );
    await notifyRentalUser(client, rental.user_id, 'HARVEST_RECORDED', rentalId);
    const summary = await getHarvestSummary(client, session.session_id);
    await client.query('COMMIT');
    return { harvest: harvestResult.rows[0], ...summary };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function completeForAdmin(rentalId, note, performedBy) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const rental = await lockRentalForLifecycle(client, rentalId);
    if (!rental) throw new AppError('Rental not found', 404);
    if (rental.status !== 'ACTIVE') {
      throw new AppError('Only active rentals can be completed', 409);
    }
    if (rental.order_status === 'CANCELLED') {
      throw new AppError('Cancelled orders cannot complete a rental', 409);
    }

    const session = await lockActiveSession(client, rentalId);
    if (!session) throw new AppError('Rental has no active cultivation session', 409);
    const tray = await lockTray(client, session.tray_id);
    if (!tray) throw new AppError('Cultivation tray not found', 409);

    const summary = await getHarvestSummary(client, session.session_id);
    if (summary.totalHarvests < 1) {
      throw new AppError('At least one harvest is required before completing a rental', 409);
    }
    const latest = await findLatestProgress(client, session.session_id);
    if (!latest) throw new AppError('Active cultivation session has no progress', 409);

    const sessionResult = await client.query(
      `UPDATE cultivation_sessions
       SET status = 'COMPLETED', end_at = CURRENT_TIMESTAMP
       WHERE session_id = $1
       RETURNING session_id, status, end_at`,
      [session.session_id],
    );
    await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date,
         expected_harvest_date, description
       )
       VALUES ($1, $2, 100, $3::timestamp::date, $4::date, $5)
       RETURNING progress_id`,
      [
        session.session_id,
        latest.current_stage,
        session.start_at,
        session.harvest_date,
        note || 'Completed',
      ],
    );
    const rentalResult = await client.query(
      `UPDATE rentals
       SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
       WHERE rental_id = $1
       RETURNING status`,
      [rentalId],
    );
    const trayResult = await client.query(
      `UPDATE cultivation_trays
       SET status = 'AVAILABLE', updated_at = CURRENT_TIMESTAMP
       WHERE tray_id = $1 AND status = 'OCCUPIED'
       RETURNING tray_id, status`,
      [session.tray_id],
    );
    const orderResult = await client.query(
      `UPDATE orders
       SET status = 'COMPLETED'
       WHERE order_id = $1 AND status IN ('CONFIRMED', 'PROCESSING')
       RETURNING status`,
      [rental.order_id],
    );
    await writeStatusLog(client, {
      rentalId,
      action: 'COMPLETE',
      fromStatus: rental.status,
      toStatus: 'COMPLETED',
      performedBy,
      note,
    });
    await notifyRentalUser(client, rental.user_id, 'RENTAL_COMPLETED', rentalId);

    await client.query('COMMIT');
    const completedSession = sessionResult.rows[0] || {
      session_id: session.session_id,
      status: 'COMPLETED',
      end_at: null,
    };
    const updatedTray = trayResult.rows[0] || tray;
    return {
      rentalId,
      rentalStatus: (rentalResult.rows[0] || {}).status || 'COMPLETED',
      orderStatus: (orderResult.rows[0] || {}).status || rental.order_status,
      session: {
        sessionId: completedSession.session_id,
        status: completedSession.status,
        endAt: completedSession.end_at,
      },
      tray: {
        trayId: updatedTray.tray_id,
        status: updatedTray.status,
      },
      harvestSummary: summary,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelForAdmin(rentalId, reason, performedBy) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const rental = await lockRentalForLifecycle(client, rentalId);
    if (!rental) throw new AppError('Rental not found', 404);
    if (!['CONFIRMED', 'PREPARING', 'ACTIVE'].includes(rental.status)) {
      throw new AppError('Only confirmed, preparing, or active rentals can be cancelled', 409);
    }

    const sessionsResult = await client.query(
      `SELECT session_id, tray_id, status, start_at
       FROM cultivation_sessions
       WHERE rental_id = $1 AND status IN ('PLANNED', 'ACTIVE')
       ORDER BY session_id DESC
       FOR UPDATE`,
      [rentalId],
    );
    const activeSessions = sessionsResult.rows.filter((session) => session.status === 'ACTIVE');
    const activeTrays = [];
    for (const session of activeSessions) {
      const tray = await lockTray(client, session.tray_id);
      if (tray) activeTrays.push(tray);
    }

    await client.query(
      `UPDATE cultivation_sessions
       SET status = 'CANCELLED',
           end_at = CASE
             WHEN CURRENT_TIMESTAMP >= start_at THEN CURRENT_TIMESTAMP
             ELSE start_at
           END
       WHERE rental_id = $1 AND status IN ('PLANNED', 'ACTIVE')`,
      [rentalId],
    );
    for (const tray of activeTrays) {
      await client.query(
        `UPDATE cultivation_trays
         SET status = 'AVAILABLE', updated_at = CURRENT_TIMESTAMP
         WHERE tray_id = $1 AND status = 'OCCUPIED'`,
        [tray.tray_id],
      );
    }
    await client.query(
      `UPDATE rentals
       SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP
       WHERE rental_id = $1`,
      [rentalId],
    );
    const orderResult = await client.query(
      `UPDATE orders
       SET status = 'CANCELLED',
           payment_status = CASE
             WHEN payment_status = 'PAID' THEN 'REFUND_PENDING'
             ELSE payment_status
           END
       WHERE order_id = $1
       RETURNING status, payment_status`,
      [rental.order_id],
    );
    await writeStatusLog(client, {
      rentalId,
      action: 'CANCEL',
      fromStatus: rental.status,
      toStatus: 'CANCELLED',
      performedBy,
      note: reason,
    });
    await notifyRentalUser(client, rental.user_id, 'RENTAL_CANCELLED', rentalId);

    await client.query('COMMIT');
    const order = orderResult.rows[0] || {
      status: 'CANCELLED',
      payment_status: rental.payment_status,
    };
    return {
      rentalId,
      rentalStatus: 'CANCELLED',
      orderStatus: order.status,
      paymentStatus: order.payment_status,
      refundRequired: rental.payment_status === 'PAID',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function startCultivationForAdmin(rentalId, trayId, performedBy) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const rentalResult = await client.query(
      `SELECT r.rental_id, r.order_id, r.user_id, r.status, r.duration_days,
              o.status AS order_status, o.payment_status
       FROM rentals r
       INNER JOIN orders o ON o.order_id = r.order_id
       WHERE r.rental_id = $1
       FOR UPDATE OF r, o`,
      [rentalId],
    );
    const rental = rentalResult.rows[0];
    if (!rental) throw new AppError('Rental not found', 404);
    if (rental.payment_status !== 'PAID') {
      throw new AppError('Only paid rentals can start cultivation', 409);
    }
    if (rental.order_status === 'CANCELLED') {
      throw new AppError('Cancelled orders cannot start cultivation', 409);
    }
    if (!['CONFIRMED', 'PREPARING'].includes(rental.status)) {
      throw new AppError('Only confirmed or preparing rentals can start cultivation', 409);
    }

    const trayResult = await client.query(
      `SELECT t.tray_id, t.status, t.floor_id
       FROM cultivation_trays t
       WHERE t.tray_id = $1
       FOR UPDATE OF t`,
      [trayId],
    );
    const tray = trayResult.rows[0];
    if (!tray) throw new AppError('Cultivation tray not found', 404);
    if (tray.status !== 'AVAILABLE') {
      throw new AppError('Cultivation tray is unavailable', 409);
    }
    if (tray.floor_id == null) {
      throw new AppError('Assign the cultivation tray to a floor before starting cultivation', 409);
    }

    const floorResult = await client.query(
      `SELECT floor_id, status
       FROM cultivation_floors
       WHERE floor_id = $1
       FOR SHARE`,
      [tray.floor_id],
    );
    const floor = floorResult.rows[0];
    if (!floor) throw new AppError('Cultivation tray floor not found', 409);
    if (floor.status !== 'ACTIVE') {
      throw new AppError('Cultivation tray floor is not active', 409);
    }

    const orderItemResult = await client.query(
      `SELECT oi.order_item_id, oi.mushroom_type_id
       FROM order_items oi
       WHERE oi.order_id = $1
         AND (
           (oi.item_type = 'RENTAL' AND oi.rental_package_id IS NOT NULL)
           OR oi.item_type = 'MUSHROOM'
         )
       ORDER BY CASE
         WHEN oi.item_type = 'RENTAL' AND oi.mushroom_type_id IS NOT NULL THEN 0
         WHEN oi.item_type = 'MUSHROOM' THEN 1
         ELSE 2
       END, oi.order_item_id
       LIMIT 1`,
      [rental.order_id],
    );
    const orderItem = orderItemResult.rows[0];
    if (!orderItem || orderItem.mushroom_type_id == null) {
      throw new AppError('No mushroom type is associated with this rental order', 409);
    }

    const mushroomResult = await client.query(
      `SELECT mushroom_type_id, name, growing_days, status
       FROM mushroom_types
       WHERE mushroom_type_id = $1`,
      [orderItem.mushroom_type_id],
    );
    const mushroom = mushroomResult.rows[0];
    if (!mushroom) {
      throw new AppError('The ordered mushroom type was not found', 409);
    }
    if (mushroom.status !== 'ACTIVE') {
      throw new AppError('The ordered mushroom type is not active', 409);
    }
    if (Number(mushroom.growing_days) > Number(rental.duration_days)) {
      throw new AppError('Mushroom growing time exceeds the rental duration', 409);
    }

    const existingSession = await client.query(
      `SELECT session_id
       FROM cultivation_sessions
       WHERE rental_id = $1
          OR (tray_id = $2 AND status IN ('PLANNED', 'ACTIVE'))
       FOR UPDATE`,
      [rentalId, trayId],
    );
    if (existingSession.rows.length > 0) {
      throw new AppError('Rental or tray already has a cultivation session', 409);
    }

    const sessionResult = await client.query(
      `INSERT INTO cultivation_sessions (
         rental_id, tray_id, mushroom_type_id, start_at, duration_days, status, harvest_date
       )
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4::integer, 'ACTIVE', CURRENT_DATE + $4::integer)
       RETURNING *`,
      [rentalId, trayId, mushroom.mushroom_type_id, mushroom.growing_days],
    );

    await client.query(
      `UPDATE rentals
       SET tray_id = $2,
           status = 'ACTIVE',
           start_date = CURRENT_TIMESTAMP,
           end_date = CURRENT_TIMESTAMP + duration_days * INTERVAL '1 day',
           updated_at = CURRENT_TIMESTAMP
       WHERE rental_id = $1`,
      [rentalId, trayId],
    );
    await client.query(
      `UPDATE cultivation_trays
       SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP
       WHERE tray_id = $1`,
      [trayId],
    );
    await client.query(
      `UPDATE orders
       SET status = 'PROCESSING'
       WHERE order_id = $1 AND status = 'CONFIRMED'`,
      [rental.order_id],
    );
    await writeStatusLog(client, {
      rentalId,
      action: 'START_CULTIVATION',
      fromStatus: rental.status,
      toStatus: 'ACTIVE',
      performedBy,
    });
    await notifyRentalUser(client, rental.user_id, 'CULTIVATION_STARTED', rentalId);
    await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date, expected_harvest_date, description
       )
       VALUES ($1, 'PREPARATION', 0, CURRENT_DATE, $2::date, 'Cultivation started')
       RETURNING *`,
      [sessionResult.rows[0].session_id, sessionResult.rows[0].harvest_date],
    );

    await client.query('COMMIT');
    return {
      session: sessionResult.rows[0],
      rental: await findByIdForAdmin(rentalId),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function dateMilliseconds(value) {
  if (value == null) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

async function updateForAdmin(rentalId, changes, performedBy) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const rentalResult = await client.query(
      `SELECT r.rental_id, r.order_id, r.user_id, r.status, r.tray_id, r.duration_days,
              r.start_date, r.end_date, o.payment_status
       FROM rentals r
       INNER JOIN orders o ON o.order_id = r.order_id
       WHERE r.rental_id = $1
       FOR UPDATE OF r`,
      [rentalId],
    );
    const rental = rentalResult.rows[0];
    if (!rental) throw new AppError('Rental not found', 404);

    const status = changes.status === undefined ? rental.status : changes.status;
    const trayId = changes.trayId === undefined ? rental.tray_id : changes.trayId;
    const durationDays = changes.durationDays === undefined
      ? rental.duration_days
      : changes.durationDays;
    const startDate = changes.startDate === undefined ? rental.start_date : changes.startDate;
    const endDate = changes.endDate === undefined ? rental.end_date : changes.endDate;

    const startTime = dateMilliseconds(startDate);
    const endTime = dateMilliseconds(endDate);
    if (startDate != null && startTime === null) {
      throw new AppError('startDate must be a valid timestamp', 400);
    }
    if (endDate != null && endTime === null) {
      throw new AppError('endDate must be a valid timestamp', 400);
    }
    if (startTime !== null && endTime !== null && endTime <= startTime) {
      throw new AppError('endDate must be after startDate', 400);
    }

    const editableStatuses = ['CONFIRMED', 'PREPARING', 'ACTIVE'];
    const changesRentalDetails = changes.trayId !== undefined
      || changes.durationDays !== undefined
      || changes.startDate !== undefined
      || changes.endDate !== undefined;
    if (changesRentalDetails && !editableStatuses.includes(rental.status)) {
      throw new AppError('Only confirmed, preparing, or active rentals can be edited', 409);
    }

    if (changes.status !== undefined) {
      const endpointByStatus = {
        ACTIVE: 'Use POST /api/rentals/admin/:rentalId/cultivation-session to start cultivation',
        COMPLETED: 'Use POST /api/rentals/admin/:rentalId/complete to complete a rental',
        CANCELLED: 'Use POST /api/rentals/admin/:rentalId/cancel to cancel a rental',
      };
      if (endpointByStatus[status]) {
        throw new AppError(endpointByStatus[status], 409);
      }
      if (rental.status !== 'CONFIRMED' || status !== 'PREPARING') {
        throw new AppError('Rental status transition is not allowed', 409);
      }
    }

    let activeSession = null;
    if (rental.status === 'ACTIVE') {
      const activeSessionResult = await client.query(
        `SELECT session_id, tray_id
         FROM cultivation_sessions
         WHERE rental_id = $1 AND status = 'ACTIVE'
         ORDER BY session_id DESC
         LIMIT 1
         FOR UPDATE`,
        [rentalId],
      );
      activeSession = activeSessionResult.rows[0];
      if (!activeSession) {
        throw new AppError('Active rental has no active cultivation session', 409);
      }
      if (activeSession.tray_id !== rental.tray_id) {
        throw new AppError('Active rental tray does not match its cultivation session', 409);
      }
    }

    if (status === 'ACTIVE' && trayId == null) {
      throw new AppError('An active rental must be assigned to a cultivation tray', 400);
    }

    if (trayId != null && (changes.trayId !== undefined || status === 'ACTIVE')) {
      const trayResult = await client.query(
        `SELECT tray_id, status
         FROM cultivation_trays
         WHERE tray_id = $1
         FOR UPDATE`,
        [trayId],
      );
      if (!trayResult.rows[0]) throw new AppError('Cultivation tray not found', 404);

      const currentActiveTray = rental.status === 'ACTIVE'
        && rental.tray_id === trayId
        && trayResult.rows[0].status === 'OCCUPIED';
      if (status === 'ACTIVE' && trayResult.rows[0].status !== 'AVAILABLE' && !currentActiveTray) {
        throw new AppError('Cultivation tray is unavailable', 409);
      }
      if (status !== 'ACTIVE'
        && changes.trayId !== undefined
        && trayResult.rows[0].status !== 'AVAILABLE') {
        throw new AppError('Cultivation tray is unavailable', 409);
      }

      if (status === 'ACTIVE') {
        const conflictResult = await client.query(
          `SELECT rental_id
           FROM rentals
           WHERE tray_id = $1
             AND rental_id <> $2
             AND status = 'ACTIVE'
             AND (start_date IS NULL OR $4::timestamp IS NULL OR start_date <= $4::timestamp)
             AND (end_date IS NULL OR $3::timestamp IS NULL OR end_date >= $3::timestamp)
           LIMIT 1`,
          [trayId, rentalId, startDate, endDate],
        );
        if (conflictResult.rows[0]) {
          throw new AppError('Cultivation tray is already assigned to an overlapping active rental', 409);
        }
      }
    }

    if (rental.status === 'ACTIVE' && rental.tray_id !== trayId) {
      const oldTrayResult = await client.query(
        `SELECT tray_id, status
         FROM cultivation_trays
         WHERE tray_id = $1
         FOR UPDATE`,
        [rental.tray_id],
      );
      if (!oldTrayResult.rows[0]) throw new AppError('Cultivation tray not found', 404);
      await client.query(
        `UPDATE cultivation_trays
         SET status = 'AVAILABLE', updated_at = NOW()
         WHERE tray_id = $1 AND status = 'OCCUPIED'`,
        [rental.tray_id],
      );
    }
    if (activeSession && activeSession.tray_id !== trayId) {
      await client.query(
        `UPDATE cultivation_sessions
         SET tray_id = $2
         WHERE session_id = $1`,
        [activeSession.session_id, trayId],
      );
    }
    if (status === 'ACTIVE') {
      await client.query(
        `UPDATE cultivation_trays
         SET status = 'OCCUPIED', updated_at = NOW()
         WHERE tray_id = $1`,
        [trayId],
      );
    } else if (rental.status === 'ACTIVE') {
      await client.query(
        `UPDATE cultivation_trays
         SET status = 'AVAILABLE', updated_at = NOW()
         WHERE tray_id = $1 AND status = 'OCCUPIED'`,
        [rental.tray_id],
      );
    }

    await client.query(
      `UPDATE rentals
       SET status = $2,
           tray_id = $3,
           duration_days = $4,
           start_date = $5,
           end_date = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE rental_id = $1`,
      [rentalId, status, trayId, durationDays, startDate, endDate],
    );
    if (rental.status === 'CONFIRMED' && status === 'PREPARING') {
      await writeStatusLog(client, {
        rentalId,
        action: 'APPROVE',
        fromStatus: rental.status,
        toStatus: 'PREPARING',
        performedBy,
      });
      await notifyRentalUser(client, rental.user_id, 'RENTAL_APPROVED', rentalId);
    }
    await client.query('COMMIT');
    return await findByIdForAdmin(rentalId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  findAllForAdmin,
  findByIdForAdmin,
  createFromOrderForAdmin,

  insertNotification,
  lockActiveSession,
  createProgressForAdmin,
  createHarvestForAdmin,
  completeForAdmin,
  cancelForAdmin,
  startCultivationForAdmin,
  updateForAdmin,
};
