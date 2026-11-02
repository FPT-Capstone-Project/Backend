const pool = require('../config/db');
const AppError = require('../utils/app-error');

function isStaff(actor) {
  return [1, 2].includes(Number(actor?.role_id));
}

function assertCustomerOrStaff(row, actor) {
  if (isStaff(actor)) return;
  if (Number(actor?.user_id) !== Number(row.customer_id)) {
    throw new AppError('You do not have permission to access this harvest request', 403);
  }
}

function sessionCanReceive(session) {
  return ['HARVEST_READY', 'HARVESTING'].includes(session.status)
    || (session.status === 'CULTIVATING' && session.harvest_status === 'HARVEST_READY');
}

async function lockRequest(client, harvestRequestId) {
  const result = await client.query(
    `SELECT hr.harvest_request_id, hr.session_id, hr.harvest_method,
            hr.scheduled_at, hr.status, hr.customer_note, hr.confirmed_at,
            hr.completed_at, s.status AS session_status, s.harvest_status,
            oi.order_id, o.user_id AS customer_id
     FROM harvest_requests hr
     INNER JOIN cultivation_sessions s ON s.session_id = hr.session_id
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE hr.harvest_request_id = $1
     FOR UPDATE OF hr, s, o`,
    [harvestRequestId],
  );
  return result.rows[0] || null;
}

async function create(sessionId, data, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessionResult = await client.query(
      `SELECT s.session_id, s.status, s.harvest_status, o.user_id AS customer_id
       FROM cultivation_sessions s
       INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
       INNER JOIN orders o ON o.order_id = oi.order_id
       WHERE s.session_id = $1
       FOR UPDATE OF s, o`,
      [sessionId],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new AppError('Cultivation session not found', 404);
    assertCustomerOrStaff(session, actor);
    if (!sessionCanReceive({ status: session.status, harvest_status: session.harvest_status })) {
      throw new AppError('Cultivation session must be harvest ready before choosing a receiving method', 409);
    }

    const result = await client.query(
      `INSERT INTO harvest_requests (
         session_id, harvest_method, scheduled_at, status, customer_note
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        sessionId,
        data.harvestMethod,
        data.scheduledAt ?? null,
        data.harvestMethod === 'PICKUP' ? 'SCHEDULED' : 'PENDING',
        data.customerNote ?? null,
      ],
    );
    await client.query(
      `UPDATE harvests
       SET harvest_request_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $1 AND harvest_request_id IS NULL`,
      [sessionId, result.rows[0].harvest_request_id],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new AppError('A receiving request already exists for this cultivation session', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function update(harvestRequestId, data, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await lockRequest(client, harvestRequestId);
    if (!request) throw new AppError('Harvest request not found', 404);
    assertCustomerOrStaff(request, actor);
    if (request.status === 'COMPLETED') {
      throw new AppError('Completed harvest requests cannot be changed', 409);
    }
    if (!sessionCanReceive({ status: request.session_status, harvest_status: request.harvest_status })) {
      throw new AppError('Receiving method can no longer be changed for this cultivation session', 409);
    }

    const result = await client.query(
      `UPDATE harvest_requests
       SET harvest_method = $2,
           scheduled_at = $3,
           status = $4,
           customer_note = COALESCE($5, customer_note)
       WHERE harvest_request_id = $1
       RETURNING *`,
      [
        harvestRequestId,
        data.harvestMethod,
        data.scheduledAt ?? null,
        data.harvestMethod === 'PICKUP' ? 'SCHEDULED' : 'PENDING',
        data.customerNote,
      ],
    );
    await client.query(
      `UPDATE harvests
       SET harvest_request_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $1 AND harvest_request_id IS NULL`,
      [request.session_id, harvestRequestId],
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

async function complete(harvestRequestId, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await lockRequest(client, harvestRequestId);
    if (!request) throw new AppError('Harvest request not found', 404);
    assertCustomerOrStaff(request, actor);
    if (request.status === 'COMPLETED') {
      throw new AppError('Harvest request is already completed', 409);
    }

    const harvestResult = await client.query(
      `SELECT harvest_id, status
       FROM harvests
       WHERE session_id = $1
       FOR UPDATE`,
      [request.session_id],
    );
    if (!harvestResult.rows[0] || harvestResult.rows[0].status !== 'COMPLETED') {
      throw new AppError('Harvest must be completed before receiving can be completed', 409);
    }

    if (request.harvest_method === 'PICKUP') {
      if (!request.scheduled_at) {
        throw new AppError('Pickup must be scheduled before receiving can be completed', 409);
      }
      if (isStaff(actor) || Number(actor?.user_id) !== Number(request.customer_id)) {
        throw new AppError('Customer pickup confirmation is required', 409);
      }
    } else {
      const shipmentResult = await client.query(
        `SELECT shipment_id, status
         FROM shipments
         WHERE order_id = $1
         ORDER BY shipment_id DESC
         LIMIT 1
         FOR UPDATE`,
        [request.order_id],
      );
      if (shipmentResult.rows[0]?.status !== 'DELIVERED') {
        throw new AppError('Delivery must be completed before receiving can be completed', 409);
      }
    }

    const result = await client.query(
      `UPDATE harvest_requests
       SET status = 'COMPLETED',
           confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP),
           completed_at = CURRENT_TIMESTAMP
       WHERE harvest_request_id = $1
       RETURNING *`,
      [harvestRequestId],
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

module.exports = { create, update, complete };
