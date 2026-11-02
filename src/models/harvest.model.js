const pool = require('../config/db');
const AppError = require('../utils/app-error');

const harvestFields = `
  h.harvest_id, h.session_id, h.harvest_request_id, h.session_tray_id,
  h.harvested_by, h.harvest_date, h.status, h.total_weight_kg,
  h.usable_weight_kg, h.rejected_weight_kg, h.quality_grade, h.notes,
  h.created_at, h.updated_at,
  s.status AS cultivation_status, s.harvest_status,
  oi.order_id, CONCAT('ORD-', oi.order_id) AS order_code,
  u.full_name AS customer_name,
  s.mushroom_type_id, mt.name AS mushroom_type,
  hr.harvest_method, hr.scheduled_at, hr.customer_note, hr.confirmed_by,
  hr.confirmed_at, hr.completed_at, hr.status AS harvest_request_status
`;

const harvestFrom = `
  FROM harvests h
  INNER JOIN cultivation_sessions s ON s.session_id = h.session_id
  INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
  INNER JOIN orders o ON o.order_id = oi.order_id
  INNER JOIN users u ON u.user_id = o.user_id
  INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
  LEFT JOIN harvest_requests hr ON hr.session_id = s.session_id
`;

function isHarvestReady(session) {
  return session.status === 'HARVEST_READY'
    || (session.status === 'CULTIVATING' && session.harvest_status === 'HARVEST_READY');
}

async function lockHarvest(client, harvestId) {
  const result = await client.query(
    `SELECT h.harvest_id, h.session_id, h.status, h.harvested_by,
            h.harvest_date, h.total_weight_kg, h.usable_weight_kg,
            h.rejected_weight_kg, s.status AS session_status, s.harvest_status
     FROM harvests h
     INNER JOIN cultivation_sessions s ON s.session_id = h.session_id
     WHERE h.harvest_id = $1
     FOR UPDATE OF h, s`,
    [harvestId],
  );
  return result.rows[0] || null;
}

async function create(sessionId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessionResult = await client.query(
      `SELECT s.session_id, s.status, s.harvest_status, o.status AS order_status
       FROM cultivation_sessions s
       INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
       INNER JOIN orders o ON o.order_id = oi.order_id
       WHERE s.session_id = $1
       FOR UPDATE OF s, o`,
      [sessionId],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (session.order_status === 'CANCELLED') {
      throw new AppError('Cultivation session does not belong to an active order', 409);
    }
    if (!isHarvestReady(session)) {
      throw new AppError('Cultivation session must be harvest ready before creating a harvest', 409);
    }

    const requestResult = await client.query(
      `SELECT harvest_request_id
       FROM harvest_requests
       WHERE session_id = $1
       LIMIT 1`,
      [sessionId],
    );
    const result = await client.query(
      `INSERT INTO harvests (session_id, harvest_request_id, status)
       VALUES ($1, $2, 'PLANNED')
       RETURNING *`,
      [sessionId, requestResult.rows[0]?.harvest_request_id ?? null],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new AppError('A harvest already exists for this cultivation session', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function start(harvestId, harvestedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const harvest = await lockHarvest(client, harvestId);
    if (!harvest) throw new AppError('Harvest not found', 404);
    if (harvest.status !== 'PLANNED') {
      throw new AppError('Only planned harvests can be started', 409);
    }
    if (!isHarvestReady({ status: harvest.session_status, harvest_status: harvest.harvest_status })) {
      throw new AppError('Cultivation session must be harvest ready before starting a harvest', 409);
    }

    const receiving = await client.query(
      `SELECT harvest_request_id, harvest_method, scheduled_at, status FROM harvest_requests
       WHERE session_id = $1 FOR UPDATE`, [harvest.session_id],
    );
    const request = receiving.rows[0];
    if (!request || !['PICKUP', 'DELIVERY'].includes(request.harvest_method)
      || request.status === 'COMPLETED' || (request.harvest_method === 'PICKUP' && !request.scheduled_at)) {
      throw new AppError('Choose a receiving method and schedule pickup before starting harvest', 409);
    }
    const issues = await client.query(
      `SELECT ci.issue_id FROM cultivation_issues ci
       INNER JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
       WHERE st.session_id = $1 AND ci.status NOT IN ('RESOLVED', 'CANCELLED')
         AND (ci.issue_type IN ('DISEASE', 'CONTAMINATION', 'QUALITY_FAILURE', 'DAMAGE') OR ci.severity = 'HIGH')
       FOR UPDATE OF ci`, [harvest.session_id],
    );
    if (issues.rows.length) throw new AppError('Resolve quality and severe incidents before harvesting', 409);
    const result = await client.query(
      `UPDATE harvests
       SET status = 'IN_PROGRESS',
           harvested_by = COALESCE(harvested_by, $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE harvest_id = $1
       RETURNING *`,
      [harvestId, harvestedBy],
    );
    await client.query(
      `UPDATE cultivation_sessions
       SET status = 'HARVESTING', harvest_status = 'HARVEST_READY'
       WHERE session_id = $1`,
      [harvest.session_id],
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

async function recordYield(harvestId, data, harvestedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const harvest = await lockHarvest(client, harvestId);
    if (!harvest) throw new AppError('Harvest not found', 404);
    if (harvest.status !== 'IN_PROGRESS') {
      throw new AppError('Yield can only be recorded for an in-progress harvest', 409);
    }
    if (harvest.session_status !== 'HARVESTING') {
      throw new AppError('Cultivation session is not harvesting', 409);
    }

    const result = await client.query(
      `UPDATE harvests
       SET total_weight_kg = $2,
           usable_weight_kg = $3,
           rejected_weight_kg = $4,
           quality_grade = $5,
           notes = $6,
           harvest_date = CURRENT_DATE,
           harvested_by = COALESCE(harvested_by, $7),
           updated_at = CURRENT_TIMESTAMP
       WHERE harvest_id = $1
       RETURNING *`,
      [
        harvestId,
        data.totalWeightKg,
        data.usableWeightKg,
        data.rejectedWeightKg,
        data.qualityGrade ?? null,
        data.notes ?? null,
        harvestedBy,
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

async function complete(harvestId, harvestedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const harvest = await lockHarvest(client, harvestId);
    if (!harvest) throw new AppError('Harvest not found', 404);
    if (harvest.status !== 'IN_PROGRESS') {
      throw new AppError('Only an in-progress harvest can be completed', 409);
    }
    if (harvest.session_status !== 'HARVESTING') {
      throw new AppError('Cultivation session is not harvesting', 409);
    }
    if (harvest.total_weight_kg === null || harvest.usable_weight_kg === null
      || harvest.rejected_weight_kg === null || !harvest.harvest_date) {
      throw new AppError('Actual yield must be recorded before completing a harvest', 409);
    }

    const result = await client.query(
      `UPDATE harvests
       SET status = 'COMPLETED',
           harvested_by = COALESCE(harvested_by, $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE harvest_id = $1
       RETURNING *`,
      [harvestId, harvestedBy],
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

async function findById(harvestId) {
  const result = await pool.query(
    `SELECT ${harvestFields}
     ${harvestFrom}
     WHERE h.harvest_id = $1
     LIMIT 1`,
    [harvestId],
  );
  return result.rows[0] || null;
}

async function findAllForAdmin(filters = {}) {
  const clauses = ['h.session_id IS NOT NULL'];
  const values = [];
  const add = (sql, value) => {
    if (value === undefined) return;
    values.push(value);
    clauses.push(`${sql} $${values.length}`);
  };

  add('h.status =', filters.status);
  add('s.mushroom_type_id =', filters.mushroomTypeId);
  add('oi.order_id =', filters.orderId);
  add('h.harvest_date >=', filters.fromDate);
  add('h.harvest_date <=', filters.toDate);
  const where = `WHERE ${clauses.join(' AND ')}`;
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total ${harvestFrom} ${where}`,
    values,
  );
  const result = await pool.query(
    `SELECT ${harvestFields}
     ${harvestFrom}
     ${where}
     ORDER BY h.created_at DESC, h.harvest_id DESC`,
    values,
  );
  return { harvests: result.rows, total: Number(countResult.rows[0]?.total || 0) };
}

async function findOrderHistory(orderId) {
  const result = await pool.query(
    `SELECT oi.order_id, CONCAT('ORD-', oi.order_id) AS order_code,
            s.session_id, s.mushroom_type_id, mt.name AS mushroom_type,
            h.harvest_id, h.status AS harvest_status, h.harvest_date,
            h.total_weight_kg, h.usable_weight_kg, h.rejected_weight_kg,
            h.quality_grade, hr.harvest_method
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
     LEFT JOIN harvests h ON h.session_id = s.session_id
     LEFT JOIN harvest_requests hr ON hr.session_id = s.session_id
     WHERE oi.order_id = $1
     ORDER BY s.session_id, h.harvest_id`,
    [orderId],
  );
  if (result.rows.length === 0) return null;
  const first = result.rows[0];
  return {
    order_id: first.order_id,
    order_code: first.order_code,
    harvests: result.rows.map((row) => ({
      session_id: row.session_id,
      mushroom_type: { id: row.mushroom_type_id, name: row.mushroom_type },
      harvest: row.harvest_id === null ? null : {
        harvest_id: row.harvest_id,
        status: row.harvest_status,
        harvest_date: row.harvest_date,
        total_weight_kg: row.total_weight_kg,
        usable_weight_kg: row.usable_weight_kg,
        rejected_weight_kg: row.rejected_weight_kg,
        quality_grade: row.quality_grade,
        harvest_method: row.harvest_method,
      },
    })),
  };
}

module.exports = {
  create,
  start,
  recordYield,
  complete,
  findById,
  findAllForAdmin,
  findOrderHistory,
};
