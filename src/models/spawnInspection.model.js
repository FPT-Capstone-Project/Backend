const pool = require('../config/db');
const AppError = require('../utils/app-error');

const sessionSelect = `
  SELECT s.session_id, s.status, s.start_at, s.harvest_date, s.duration_days,
         oi.order_item_id, oi.quantity AS tray_quantity,
         oi.quantity * 3 AS spawn_quantity, oi.mushroom_type_id,
         mt.name AS mushroom_name, o.order_id, o.user_id, o.payment_status,
         u.full_name AS customer_name, u.email AS customer_email,
         EXISTS (
           SELECT 1 FROM inventory_transactions it
           WHERE it.session_id = s.session_id AND it.transaction_type = 'OUT'
         ) AS spawn_issued
  FROM cultivation_sessions s
  INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
  INNER JOIN orders o ON o.order_id = oi.order_id
  INNER JOIN users u ON u.user_id = o.user_id
  INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
`;

async function findAllForFarm(status) {
  const values = [];
  let filter = `WHERE o.payment_status = 'PAID'
    AND s.status IN (
      'PENDING', 'SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT',
      'READY_FOR_CULTIVATION', 'CULTIVATING', 'HARVESTING'
    )`;
  if (status) {
    values.push(status);
    filter = `WHERE o.payment_status = 'PAID' AND s.status = $1`;
  }
  const result = await pool.query(
    `SELECT s.session_id, s.status, s.start_at, s.harvest_date,
            oi.order_item_id, oi.quantity AS tray_quantity, oi.quantity * 3 AS spawn_quantity,
            mt.name AS mushroom_name, o.order_id, u.full_name AS customer_name,
            (SELECT MAX(si.inspected_at) FROM spawn_inspections si
             WHERE si.session_id = s.session_id) AS last_inspected_at
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     INNER JOIN users u ON u.user_id = o.user_id
     INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
     ${filter}
     ORDER BY s.created_at ASC, s.session_id ASC`,
    values,
  );
  return result.rows;
}

async function findByIdForFarm(sessionId) {
  const result = await pool.query(
    `${sessionSelect}
     WHERE s.session_id = $1 AND o.payment_status = 'PAID'
     LIMIT 1`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function lockSession(client, sessionId) {
  const result = await client.query(
    `${sessionSelect}
     WHERE s.session_id = $1
     FOR UPDATE OF s, o`,
    [sessionId],
  );
  return result.rows[0] || null;
}

async function issueReplacementStock(client, session, quantity, notes) {
  const inventory = await client.query(
    `SELECT inventory_id, quantity
     FROM spawn_inventory
     WHERE mushroom_type_id = $1
     FOR UPDATE`,
    [session.mushroom_type_id],
  );
  const currentInventory = inventory.rows[0];
  if (!currentInventory || Number(currentInventory.quantity) < quantity) {
    throw new AppError('Insufficient spawn inventory to replace the abnormal spawn', 409, 'INSUFFICIENT_SPAWN');
  }
  const updated = await client.query(
    `UPDATE spawn_inventory
     SET quantity = quantity - $2, updated_at = CURRENT_TIMESTAMP
     WHERE inventory_id = $1 AND quantity >= $2
     RETURNING quantity`,
    [currentInventory.inventory_id, quantity],
  );
  if (!updated.rows[0]) {
    throw new AppError('Spawn inventory changed while replacing spawn', 409, 'INSUFFICIENT_SPAWN');
  }
  await client.query(
    `INSERT INTO inventory_transactions (
       inventory_id, session_id, transaction_type, quantity,
       quantity_before, quantity_after, notes
     )
     VALUES ($1, $2, 'OUT', $3, $4, $5, $6)`,
    [
      currentInventory.inventory_id,
      session.session_id,
      quantity,
      Number(currentInventory.quantity),
      Number(updated.rows[0].quantity),
      notes,
    ],
  );
}

async function createInspection(sessionId, inspectedBy, data) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (session.payment_status !== 'PAID') {
      throw new AppError('Only paid sessions can be inspected', 409);
    }

    const stage = session.status === 'SPAWN_RESTING'
      ? 'RESTING'
      : session.status === 'MYCELIAL_DEVELOPMENT'
        ? 'MYCELIAL_DEVELOPMENT'
        : null;
    if (!stage) {
      throw new AppError('Spawn inspections are allowed only while spawn is resting or incubating', 409);
    }
    if (data.totalChecked > Number(session.spawn_quantity)) {
      throw new AppError('totalChecked cannot exceed the spawn quantity in this session', 400);
    }

    const inserted = await client.query(
      `INSERT INTO spawn_inspections (
         session_id, inspected_by, stage, total_checked, normal_quantity,
         warning_quantity, abnormal_quantity, condition, notes,
         replacement_quantity, next_check_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamp)
       RETURNING *`,
      [
        sessionId,
        inspectedBy,
        stage,
        data.totalChecked,
        data.normalQuantity,
        data.warningQuantity,
        data.abnormalQuantity,
        data.condition,
        data.notes ?? null,
        data.replacementQuantity ?? 0,
        data.nextCheckAt ?? null,
      ],
    );
    const inspection = inserted.rows[0];

    if (data.replacementQuantity > 0) {
      await issueReplacementStock(
        client,
        session,
        data.replacementQuantity,
        `Spawn replacement for inspection ${inspection.inspection_id}`,
      );
    }

    await client.query('COMMIT');
    return inspection;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function replaceAbnormalSpawn(inspectionId, quantity) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT si.inspection_id, si.session_id, si.stage, si.abnormal_quantity,
              si.replacement_quantity, s.status AS session_status,
              s.mushroom_type_id, o.payment_status
       FROM spawn_inspections si
       INNER JOIN cultivation_sessions s ON s.session_id = si.session_id
       INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
       INNER JOIN orders o ON o.order_id = oi.order_id
       WHERE si.inspection_id = $1
       FOR UPDATE OF si, s, o`,
      [inspectionId],
    );
    const inspection = result.rows[0];
    if (!inspection) throw new AppError('Spawn inspection not found', 404);
    if (inspection.payment_status !== 'PAID') {
      throw new AppError('Only paid sessions can issue replacement spawn', 409);
    }
    const matchingStage = inspection.stage === 'RESTING'
      ? inspection.session_status === 'SPAWN_RESTING'
      : inspection.session_status === 'MYCELIAL_DEVELOPMENT';
    if (!matchingStage) {
      throw new AppError('Replacement spawn can only be issued during the inspection stage', 409);
    }
    const remaining = Number(inspection.abnormal_quantity) - Number(inspection.replacement_quantity);
    if (quantity > remaining) {
      throw new AppError('replacementQuantity cannot exceed the remaining abnormal quantity', 400);
    }
    await issueReplacementStock(
      client,
      { session_id: inspection.session_id, mushroom_type_id: inspection.mushroom_type_id },
      quantity,
      `Spawn replacement for inspection ${inspection.inspection_id}`,
    );
    const updated = await client.query(
      `UPDATE spawn_inspections
       SET replacement_quantity = replacement_quantity + $2
       WHERE inspection_id = $1
       RETURNING *`,
      [inspectionId, quantity],
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

async function findInspectionHistory(sessionId) {
  const result = await pool.query(
    `SELECT si.*,
            u.full_name AS inspected_by_name,
            COALESCE((
              SELECT json_agg(json_build_object(
                'image_id', sim.image_id,
                'image_url', sim.image_url,
                'caption', sim.caption,
                'created_at', sim.created_at
              ) ORDER BY sim.created_at, sim.image_id)
              FROM spawn_inspection_images sim
              WHERE sim.inspection_id = si.inspection_id
            ), '[]'::json) AS images
     FROM spawn_inspections si
     INNER JOIN users u ON u.user_id = si.inspected_by
     WHERE si.session_id = $1
     ORDER BY si.inspected_at DESC, si.inspection_id DESC`,
    [sessionId],
  );
  return result.rows;
}

async function findInspectionForImage(inspectionId) {
  const result = await pool.query(
    `SELECT inspection_id FROM spawn_inspections WHERE inspection_id = $1`,
    [inspectionId],
  );
  return result.rows[0] || null;
}

async function createImage(inspectionId, imageUrl, caption) {
  const result = await pool.query(
    `INSERT INTO spawn_inspection_images (inspection_id, image_url, caption)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [inspectionId, imageUrl, caption ?? null],
  );
  return result.rows[0];
}

async function changeStage(sessionId, nextStage) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const session = await lockSession(client, sessionId);
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (session.payment_status !== 'PAID') {
      throw new AppError('Only paid sessions can change stage', 409);
    }

    const transitions = {
      PENDING: 'SPAWN_RESTING',
      SPAWN_RESTING: 'MYCELIAL_DEVELOPMENT',
      MYCELIAL_DEVELOPMENT: 'READY_FOR_CULTIVATION',
      READY_FOR_CULTIVATION: 'CULTIVATING',
      CULTIVATING: 'HARVESTING',
    };
    if (transitions[session.status] !== nextStage) {
      throw new AppError(`Cannot change session from ${session.status} to ${nextStage}`, 409);
    }

    if (session.status === 'PENDING') {
      const stockOut = await client.query(
        `SELECT transaction_id
         FROM inventory_transactions
         WHERE session_id = $1 AND transaction_type = 'OUT'
         LIMIT 1`,
        [sessionId],
      );
      if (!stockOut.rows[0]) {
        throw new AppError('Spawn inventory has not been issued for this session', 409);
      }
    }

    if (nextStage === 'MYCELIAL_DEVELOPMENT') {
      const restingInspection = await client.query(
        `SELECT condition
         FROM spawn_inspections
         WHERE session_id = $1 AND stage = 'RESTING'
         ORDER BY inspected_at DESC, inspection_id DESC
         LIMIT 1`,
        [sessionId],
      );
      if (!restingInspection.rows[0] || restingInspection.rows[0].condition !== 'NORMAL') {
        throw new AppError('A normal resting inspection is required before mycelial development', 409);
      }
    }

    if (nextStage === 'HARVESTING') {
      const progress = await client.query(
        `SELECT current_stage
         FROM cultivation_progress
         WHERE session_id = $1
         ORDER BY progress_id DESC
         LIMIT 1`,
        [sessionId],
      );
      if (!progress.rows[0] || progress.rows[0].current_stage !== 'HARVEST') {
        throw new AppError('Cultivation progress must reach HARVEST before entering the harvesting status', 409);
      }
    }

    if (nextStage === 'READY_FOR_CULTIVATION') {
      const latestInspection = await client.query(
        `SELECT stage, condition, total_checked
         FROM spawn_inspections
         WHERE session_id = $1
         ORDER BY inspected_at DESC, inspection_id DESC
         LIMIT 1`,
        [sessionId],
      );
      if (!latestInspection.rows[0]
        || latestInspection.rows[0].stage !== 'MYCELIAL_DEVELOPMENT'
        || latestInspection.rows[0].condition !== 'NORMAL'
        || Number(latestInspection.rows[0].total_checked) !== Number(session.spawn_quantity)) {
        throw new AppError('A normal inspection of all spawn units is required before assigning trays', 409);
      }

      const trays = await client.query(
        `SELECT t.tray_id
         FROM cultivation_trays t
         INNER JOIN cultivation_floors f ON f.floor_id = t.floor_id
         WHERE t.status = 'AVAILABLE' AND f.status = 'ACTIVE'
         ORDER BY t.tray_id
         FOR UPDATE OF t`,
      );
      const held = await client.query(
        `SELECT COALESCE(SUM(tr.quantity), 0)::int AS quantity
         FROM tray_reservations tr
         INNER JOIN order_items oi ON oi.order_item_id = tr.order_item_id
         INNER JOIN orders o ON o.order_id = oi.order_id
         WHERE tr.status = 'HELD' AND tr.expires_at > CURRENT_TIMESTAMP
           AND o.status = 'PENDING'
           AND o.payment_status IN ('UNPAID', 'PENDING', 'FAILED')`,
      );
      const otherSessions = await client.query(
        `SELECT COALESCE(SUM(oi.quantity), 0)::int AS quantity
         FROM cultivation_sessions s
         INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
         WHERE s.status IN ('PENDING', 'SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT')
           AND s.session_id <> $1`,
        [sessionId],
      );
      const quantity = Number(session.tray_quantity);
      const available = trays.rows.length
        - Number(held.rows[0]?.quantity || 0)
        - Number(otherSessions.rows[0]?.quantity || 0);
      if (available < quantity) {
        throw new AppError('Not enough available trays to start cultivation', 409, 'INSUFFICIENT_TRAYS');
      }
      for (const tray of trays.rows.slice(0, quantity)) {
        const assigned = await client.query(
          `UPDATE cultivation_trays
           SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP
           WHERE tray_id = $1 AND status = 'AVAILABLE'
           RETURNING tray_id`,
          [tray.tray_id],
        );
        if (!assigned.rows[0]) throw new AppError('A cultivation tray is no longer available', 409);
        await client.query(
          `INSERT INTO cultivation_session_trays (session_id, tray_id, status)
           VALUES ($1, $2, 'ACTIVE')`,
          [sessionId, tray.tray_id],
        );
      }
    }

    const updated = await client.query(
      `UPDATE cultivation_sessions
       SET status = $2::varchar,
           start_at = CASE WHEN $2::varchar = 'CULTIVATING' THEN CURRENT_TIMESTAMP ELSE start_at END,
           harvest_date = CASE
             WHEN $2::varchar = 'CULTIVATING' THEN CURRENT_DATE + duration_days
             ELSE harvest_date
           END
       WHERE session_id = $1
       RETURNING session_id, status, start_at, harvest_date`,
      [sessionId, nextStage],
    );
    await client.query(
      `INSERT INTO cultivation_progress (
         session_id, current_stage, progress_percent, start_date,
         expected_harvest_date, description
       )
       VALUES ($1, $2, 0, CURRENT_DATE, $3, $4)`,
      [sessionId, nextStage, updated.rows[0].harvest_date, `Spawn stage changed to ${nextStage}`],
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

async function findCustomerSessions(orderId, userId, isAdmin = false) {
  const ownerFilter = isAdmin ? '' : 'AND o.user_id = $2';
  const values = isAdmin ? [orderId] : [orderId, userId];
  const result = await pool.query(
    `SELECT s.session_id, s.status, s.start_at, s.harvest_date, s.duration_days,
            oi.order_item_id, oi.quantity AS tray_quantity, oi.quantity * 3 AS spawn_quantity,
            mt.name AS mushroom_name, o.order_id
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
     WHERE o.order_id = $1 ${ownerFilter}
     ORDER BY s.session_id`,
    values,
  );
  if (result.rows.length === 0) {
    const order = await pool.query(
      `SELECT o.order_id FROM orders o WHERE o.order_id = $1 ${ownerFilter}`,
      values,
    );
    if (!order.rows[0]) throw new AppError('Order not found', 404);
  }
  return result.rows;
}

async function findCustomerProgress(orderId, userId, isAdmin = false) {
  const sessions = await findCustomerSessions(orderId, userId, isAdmin);
  if (sessions.length === 0) return [];
  const ownerFilter = isAdmin ? '' : 'AND o.user_id = $2';
  const values = isAdmin ? [orderId] : [orderId, userId];
  const result = await pool.query(
    `SELECT cp.progress_id, cp.session_id, cp.current_stage, cp.progress_percent,
            cp.start_date, cp.expected_harvest_date, cp.description, cp.updated_at
     FROM cultivation_progress cp
     INNER JOIN cultivation_sessions s ON s.session_id = cp.session_id
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE o.order_id = $1 ${ownerFilter}
     ORDER BY cp.session_id, cp.progress_id`,
    values,
  );
  return result.rows;
}

async function findCustomerInspections(orderId, userId, inspectionId, isAdmin = false) {
  await findCustomerSessions(orderId, userId, isAdmin);
  const ownerFilter = isAdmin ? '' : 'AND o.user_id = $2';
  const values = isAdmin ? [orderId] : [orderId, userId];
  const inspectionParameter = values.length + 1;
  const inspectionFilter = inspectionId ? `AND si.inspection_id = $${inspectionParameter}` : '';
  if (inspectionId) values.push(inspectionId);
  const result = await pool.query(
    `SELECT si.inspection_id, si.session_id, si.stage, si.total_checked,
            si.normal_quantity, si.warning_quantity, si.abnormal_quantity,
            si.condition, si.notes, si.replacement_quantity, si.next_check_at,
            si.inspected_at, si.created_at, u.full_name AS inspected_by_name,
            COALESCE((
              SELECT json_agg(json_build_object(
                'image_id', sim.image_id,
                'image_url', sim.image_url,
                'caption', sim.caption,
                'created_at', sim.created_at
              ) ORDER BY sim.created_at, sim.image_id)
              FROM spawn_inspection_images sim
              WHERE sim.inspection_id = si.inspection_id
            ), '[]'::json) AS images
     FROM spawn_inspections si
     INNER JOIN cultivation_sessions s ON s.session_id = si.session_id
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     INNER JOIN users u ON u.user_id = si.inspected_by
     WHERE o.order_id = $1 ${ownerFilter} ${inspectionFilter}
     ORDER BY si.inspected_at DESC, si.inspection_id DESC`,
    values,
  );
  return result.rows;
}

module.exports = {
  findAllForFarm,
  findByIdForFarm,
  createInspection,
  replaceAbnormalSpawn,
  findInspectionHistory,
  findInspectionForImage,
  createImage,
  changeStage,
  findCustomerSessions,
  findCustomerProgress,
  findCustomerInspections,
};
