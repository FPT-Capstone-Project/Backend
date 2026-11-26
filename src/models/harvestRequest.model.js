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
  return session.harvest_status === 'HARVEST_READY'
    && ['CULTIVATING', 'HARVEST_READY'].includes(session.status);
}
function vietnamDateKey(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addCalendarDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assertCustomerPickupSchedule(scheduledAt, harvestReadyAt) {
  const scheduled = new Date(scheduledAt);
  const now = new Date();
  const readyDate = vietnamDateKey(harvestReadyAt);
  if (!readyDate) throw new AppError('Harvest readiness timestamp is missing or invalid', 409);
  const scheduledDate = vietnamDateKey(scheduled);
  if (!scheduledDate) throw new AppError('Pickup schedule is invalid', 400);

  const today = vietnamDateKey(now);
  const firstAllowedDate = today > readyDate ? today : readyDate;
  const lastAllowedDate = addCalendarDays(readyDate, 3);
  if (scheduledDate < firstAllowedDate || scheduledDate > lastAllowedDate) {
    throw new AppError('Customer pickup must be scheduled from today through three days after harvest readiness', 400);
  }

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(scheduled);
  const timeValues = Object.fromEntries(timeParts.map((part) => [part.type, part.value]));
  const hour = Number(timeValues.hour);
  const minutes = hour * 60 + Number(timeValues.minute);
  const seconds = minutes * 60 + Number(timeValues.second) + scheduled.getUTCMilliseconds() / 1000;
  if (seconds < 7 * 3600 || seconds > 17 * 3600) {
    throw new AppError('Customer pickup time must be between 07:00 and 17:00 Vietnam time', 400);
  }
  if (scheduled < now) {
    throw new AppError('Customer pickup schedule cannot be in the past', 400);
  }
}

function assertCustomerCanChangeMethod(harvestReadyAt) {
  const readyDate = vietnamDateKey(harvestReadyAt);
  const today = vietnamDateKey(new Date());
  if (!readyDate || !today || today < readyDate || today > addCalendarDays(readyDate, 1)) {
    throw new AppError('Customers may update the receiving method only on the harvest-ready day and the following day', 409);
  }
}
async function notifyReceivingMethod(
  client,
  userId,
  sessionId,
  harvestMethod,
  action,
  notifyOperators,
) {
  const isPickup = harvestMethod === 'PICKUP';
  await client.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, reference_type, reference_id
     )
     VALUES ($1, 'CULTIVATION_STATUS', $2, $3, 'CULTIVATION_SESSION', $4)`,
    [
      userId,
      isPickup ? 'Đã ghi nhận yêu cầu khách đến hái' : 'Đã ghi nhận yêu cầu giao hàng',
      isPickup
        ? 'Lựa chọn khách đến hái nấm tại trang trại đã được ghi nhận.'
        : 'Yêu cầu giao nấm của bạn đã được ghi nhận.',
      sessionId,
    ],
  );

  if (!notifyOperators) return;

  const actionText = action === 'updated' ? 'đã cập nhật' : 'đã chọn';
  const methodText = isPickup ? 'đến hái tại trang trại' : 'giao hàng';
  await client.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, reference_type, reference_id
     )
     SELECT user_id, 'CULTIVATION_STATUS', $1, $2, 'CULTIVATION_SESSION', $3
     FROM users
     WHERE role_id = 2 AND status = 'ACTIVE'`,
    [
      action === 'updated'
        ? 'Khách hàng đã cập nhật phương thức nhận nấm'
        : 'Khách hàng đã chọn phương thức nhận nấm',
      `Khách hàng ${actionText} phương thức ${methodText} cho phiên nuôi trồng #${sessionId}.`,
      sessionId,
    ],
  );
}

async function lockRequest(client, harvestRequestId) {
  await client.query(
    `SELECT session_id FROM cultivation_sessions WHERE session_id = (
       SELECT session_id FROM harvest_requests WHERE harvest_request_id = $1
     ) FOR UPDATE`,
    [harvestRequestId],
  );
  const result = await client.query(
    `SELECT hr.harvest_request_id, hr.session_id, hr.harvest_method,
            hr.scheduled_at, hr.status, hr.customer_note, hr.confirmed_at,
            hr.completed_at, hr.delivery_address, s.status AS session_status, s.harvest_status, s.harvest_ready_at,
            oi.order_id, o.user_id AS customer_id,
            u.full_name AS customer_name, u.phone AS customer_phone
     FROM harvest_requests hr
     INNER JOIN cultivation_sessions s ON s.session_id = hr.session_id
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     INNER JOIN users u ON u.user_id = o.user_id
     WHERE hr.harvest_request_id = $1`,
    [harvestRequestId],
  );
  return result.rows[0] || null;
}

async function resolveDeliveryAddress(client, data, customerId) {
  if (data.harvestMethod !== 'DELIVERY') return null;
  if (data.deliveryAddress?.trim()) return data.deliveryAddress.trim();
  const result = await client.query('SELECT address FROM users WHERE user_id = $1', [customerId]);
  const address = result.rows[0]?.address?.trim();
  if (!address) {
    throw new AppError('deliveryAddress is required when the customer profile has no address', 400);
  }
  return address;
}

async function create(sessionId, data, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessionResult = await client.query(
       `SELECT s.session_id, s.status, s.harvest_status, s.harvest_ready_at,
               o.status AS order_status, o.user_id AS customer_id, u.phone AS customer_phone
       FROM cultivation_sessions s
       INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
       INNER JOIN orders o ON o.order_id = oi.order_id
       INNER JOIN users u ON u.user_id = o.user_id
       WHERE s.session_id = $1
       FOR UPDATE OF s`,
      [sessionId],
    );
    const session = sessionResult.rows[0];
    if (!session) throw new AppError('Cultivation session not found', 404);
    if (Number(actor?.role_id) !== 3) throw new AppError('Customer role required', 403);
    assertCustomerOrStaff(session, actor);
    if (session.order_status === 'CANCELLED') throw new AppError('Cultivation order is cancelled', 409);
    if (!sessionCanReceive({ status: session.status, harvest_status: session.harvest_status })) {
      throw new AppError('Cultivation session must be harvest ready before choosing a receiving method', 409);
    }
    await assertNoHarvest(client, sessionId);
    if (data.harvestMethod === 'PICKUP') {
      assertCustomerPickupSchedule(data.scheduledAt, session.harvest_ready_at);
    }
    if (data.harvestMethod === 'DELIVERY' && !data.deliveryAddress?.trim()) {
      throw new AppError('deliveryAddress is required for DELIVERY', 400);
    }
    if (data.harvestMethod === 'DELIVERY' && !session.customer_phone?.trim()) {
      throw new AppError('Customer profile phone is required for delivery', 400);
    }
    const deliveryAddress = data.harvestMethod === 'DELIVERY' ? data.deliveryAddress : null;
    const result = await client.query(
      `INSERT INTO harvest_requests (
         session_id, harvest_method, scheduled_at, status, customer_note, delivery_address
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        sessionId,
        data.harvestMethod,
        data.scheduledAt ?? null,
        data.harvestMethod === 'PICKUP' ? 'SCHEDULED' : 'PENDING',
        data.customerNote ?? null,
        deliveryAddress,
      ],
    );
    await notifyReceivingMethod(
      client,
      session.customer_id,
      sessionId,
      data.harvestMethod,
      'selected',
      !isStaff(actor),
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
    assertOpen(request);
    await assertNoHarvest(client, request.session_id);
    if (!sessionCanReceive({ status: request.session_status, harvest_status: request.harvest_status })) {
      throw new AppError('Receiving method can no longer be changed for this cultivation session', 409);
    }
    if (!isStaff(actor)) assertCustomerCanChangeMethod(request.harvest_ready_at);
    if (data.harvestMethod === 'PICKUP') {
      assertCustomerPickupSchedule(data.scheduledAt, request.harvest_ready_at);
    }
    if (data.harvestMethod === 'DELIVERY' && !request.customer_phone?.trim()) {
      throw new AppError('Customer profile phone is required for delivery', 400);
    }
    const deliveryAddress = await resolveDeliveryAddress(client, data, request.customer_id);
    const result = await client.query(
      `UPDATE harvest_requests
       SET harvest_method = $2,
           scheduled_at = $3,
           status = $4,
           customer_note = COALESCE($5, customer_note),
           delivery_address = $6
       WHERE harvest_request_id = $1
       RETURNING *`,
      [
        harvestRequestId,
        data.harvestMethod,
        data.scheduledAt ?? null,
        data.harvestMethod === 'PICKUP' ? 'SCHEDULED' : 'PENDING',
        data.customerNote,
        deliveryAddress,
      ],
    );
    const previousScheduledAt = request.scheduled_at
      ? new Date(request.scheduled_at).getTime()
      : null;
    const nextScheduledAt = data.scheduledAt
      ? new Date(data.scheduledAt).getTime()
      : null;
    const methodChanged = request.harvest_method !== data.harvestMethod;
    if (methodChanged || previousScheduledAt !== nextScheduledAt) {
      await notifyReceivingMethod(
        client,
        request.customer_id,
        request.session_id,
        data.harvestMethod,
        'updated',
        !isStaff(actor) && methodChanged,
      );
    }
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function assertOpen(request) {
  if (['COMPLETED', 'CANCELLED'].includes(request.status)) {
    throw new AppError('Completed or cancelled harvest requests cannot be changed', 409);
  }
}

async function assertNoHarvest(client, sessionId) {
  const harvest = await client.query('SELECT 1 FROM harvests WHERE session_id = $1', [sessionId]);
  if (harvest.rows.length) throw new AppError('A harvest already exists for this cultivation session', 409);
}

async function cancel(harvestRequestId, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await lockRequest(client, harvestRequestId);
    if (!request) throw new AppError('Harvest request not found', 404);
    if (Number(actor?.role_id) !== 3) throw new AppError('Customer role required', 403);
    assertCustomerOrStaff(request, actor);
    assertOpen(request);
    await assertNoHarvest(client, request.session_id);
    const result = await client.query(
      "UPDATE harvest_requests SET status = 'CANCELLED' WHERE harvest_request_id = $1 RETURNING *",
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

async function completeHandover(client, request, actorId) {
  assertOpen(request);
  if (request.session_status !== 'HARVESTING') {
    throw new AppError('Only a harvesting session can complete handover', 409);
  }

  const result = await client.query(
    `UPDATE harvest_requests
     SET status = 'COMPLETED',
         confirmed_at = COALESCE(confirmed_at, CURRENT_TIMESTAMP),
         confirmed_by = $2,
         completed_at = CURRENT_TIMESTAMP
     WHERE harvest_request_id = $1
     RETURNING *`,
    [request.harvest_request_id, actorId],
  );
  await client.query(
    `UPDATE cultivation_sessions SET status = 'COMPLETED', harvest_status = 'NOT_READY',
       end_at = CURRENT_TIMESTAMP WHERE session_id = $1`, [request.session_id],
  );
  const remainingSessions = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM cultivation_sessions
     WHERE order_item_id IN (
       SELECT order_item_id FROM order_items WHERE order_id = $1
     )
       AND status NOT IN ('COMPLETED', 'CANCELLED')`,
    [request.order_id],
  );
  if (Number(remainingSessions.rows[0]?.total || 0) === 0) {
    await client.query(
      `UPDATE orders
       SET status = 'COMPLETED'
       WHERE order_id = $1 AND status IN ('CONFIRMED', 'PROCESSING')`,
      [request.order_id],
    );
  }
  // Handover queues trays for WF-05; it never makes dirty trays AVAILABLE.
  await client.query(
    `UPDATE cultivation_trays SET status = 'MAINTENANCE'
     WHERE tray_id IN (SELECT tray_id FROM cultivation_session_trays
       WHERE session_id = $1 AND status = 'ACTIVE')`, [request.session_id],
  );
  await client.query(
    `UPDATE cultivation_session_trays SET status = 'RELEASED', notes = 'Awaiting sanitation after harvest handover'
     WHERE session_id = $1 AND status = 'ACTIVE'`, [request.session_id],
  );
  await client.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, reference_type, reference_id
     )
     VALUES ($1, 'CULTIVATION_COMPLETED', 'Vụ trồng đã hoàn tất',
             'Thu hoạch và bàn giao đơn hàng của bạn đã hoàn tất.',
             'CULTIVATION_SESSION', $2)`,
    [request.customer_id, request.session_id],
  );
  return result.rows[0];
}

// Legacy endpoint also handles pickups harvested before V2.
async function complete(harvestRequestId, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const request = await lockRequest(client, harvestRequestId);
    if (!request) throw new AppError('Harvest request not found', 404);
    assertCustomerOrStaff(request, actor);
    if (request.status === 'COMPLETED') {
      const result = await client.query(
        'SELECT * FROM harvest_requests WHERE harvest_request_id = $1', [harvestRequestId],
      );
      await client.query('COMMIT');
      return result.rows[0];
    }
    if (request.harvest_method !== 'PICKUP' || !request.scheduled_at) {
      throw new AppError('Delivery handover requires customer shipment confirmation', 409);
    }
    const harvest = await client.query(
      "SELECT 1 FROM harvests WHERE session_id = $1 AND harvest_request_id = $2 AND status = 'COMPLETED'",
      [request.session_id, harvestRequestId],
    );
    if (!harvest.rows.length) throw new AppError('Harvest must be completed before handover', 409);
    const result = await completeHandover(client, request, actor.user_id);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findAllForAdmin() {
  const result = await pool.query(
    `SELECT hr.*, oi.order_id, CONCAT('ORD-', oi.order_id) AS order_code,
            o.user_id AS customer_id, u.full_name AS customer_name,
            u.phone AS customer_phone, u.email AS customer_email,
            s.status AS session_status
     FROM harvest_requests hr
     INNER JOIN cultivation_sessions s ON s.session_id = hr.session_id
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     INNER JOIN users u ON u.user_id = o.user_id
     ORDER BY hr.harvest_request_id DESC`,
  );
  return { requests: result.rows, total: result.rows.length };
}

module.exports = { create, update, cancel, complete, findAllForAdmin, lockRequest, completeHandover };
