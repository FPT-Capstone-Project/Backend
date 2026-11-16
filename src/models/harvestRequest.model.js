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
function vietnamDateKey(value) {
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
  const readyDate = vietnamDateKey(harvestReadyAt);
  const scheduledDate = vietnamDateKey(scheduled);
  const today = vietnamDateKey(new Date());
  if (!readyDate || !scheduledDate || !today) {
    throw new AppError('Harvest readiness time or pickup schedule is invalid', 400);
  }

  const firstAllowedDate = today > readyDate ? today : readyDate;
  const lastAllowedDate = addCalendarDays(readyDate, 3);
  if (scheduledDate < firstAllowedDate || scheduledDate > lastAllowedDate) {
    throw new AppError('Customer pickup must be scheduled from today through three days after harvest readiness', 400);
  }

  const timeParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(scheduled);
  const timeValues = Object.fromEntries(timeParts.map((part) => [part.type, part.value]));
  const hour = Number(timeValues.hour);
  const minute = Number(timeValues.minute);
  if (hour < 7 || hour > 17 || (hour === 17 && minute > 0)) {
    throw new AppError('Customer pickup time must be between 07:00 and 17:00 Vietnam time', 400);
  }
  if (scheduled.getTime() <= Date.now()) {
    throw new AppError('Customer pickup schedule must be in the future', 400);
  }
}

function assertCustomerCanChangeMethod(harvestReadyAt) {
  const readyDate = vietnamDateKey(harvestReadyAt);
  const today = vietnamDateKey(new Date());
  if (!readyDate || !today || today < readyDate || today > addCalendarDays(readyDate, 1)) {
    throw new AppError('Customers may update the receiving method only on the harvest-ready day and the following day', 409);
  }
}
async function notifyReceivingMethod(client, userId, sessionId, harvestMethod) {
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
}

async function lockRequest(client, harvestRequestId) {
  const result = await client.query(
    `SELECT hr.harvest_request_id, hr.session_id, hr.harvest_method,
            hr.scheduled_at, hr.status, hr.customer_note, hr.confirmed_at,
            hr.completed_at, s.status AS session_status, s.harvest_status, s.harvest_ready_at,
            oi.order_id, o.user_id AS customer_id,
            u.full_name AS customer_name, u.phone AS customer_phone
     FROM harvest_requests hr
     INNER JOIN cultivation_sessions s ON s.session_id = hr.session_id
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     INNER JOIN users u ON u.user_id = o.user_id
     WHERE hr.harvest_request_id = $1
     FOR UPDATE OF hr, s, o`,
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

async function syncDeliveryShipment(
  client,
  request,
  harvestMethod,
  deliveryAddress,
  previousMethod = null,
) {
  const activeShipments = await client.query(
    `SELECT shipment_id, address, recipient_name, recipient_phone, status
     FROM shipments
     WHERE order_id = $1 AND status IN ('PENDING', 'SHIPPED', 'IN_TRANSIT')
     ORDER BY shipment_id DESC
     FOR UPDATE`,
    [request.order_id],
  );
  if (activeShipments.rows.length > 1) {
    throw new AppError('Order has multiple active shipments and cannot be synchronized automatically', 409);
  }
  const shipment = activeShipments.rows[0];
  const deliveryRequests = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM harvest_requests hr
     INNER JOIN cultivation_sessions s ON s.session_id = hr.session_id
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     WHERE oi.order_id = $1 AND hr.harvest_method = 'DELIVERY'`,
    [request.order_id],
  );

  if (harvestMethod === 'DELIVERY') {
    const recipientPhone = request.customer_phone?.trim();
    if (!recipientPhone) {
      throw new AppError('Customer profile phone is required for delivery', 400);
    }

    if (shipment) {
      const detailsChanged = shipment.address !== deliveryAddress
        || shipment.recipient_name !== request.customer_name
        || shipment.recipient_phone !== recipientPhone;
      if (!detailsChanged) return;
      if (shipment.status !== 'PENDING' || Number(deliveryRequests.rows[0]?.total) > 1) {
        throw new AppError('Order already has an active shipment with different delivery details', 409);
      }
      await client.query(
        `UPDATE shipments
         SET address = $2, recipient_name = $3, recipient_phone = $4
         WHERE shipment_id = $1`,
        [shipment.shipment_id, deliveryAddress, request.customer_name, recipientPhone],
      );
      return;
    }

    await client.query(
      `INSERT INTO shipments (order_id, address, recipient_name, recipient_phone)
       VALUES ($1, $2, $3, $4)`,
      [request.order_id, deliveryAddress, request.customer_name, recipientPhone],
    );
    return;
  }

  if (previousMethod !== 'DELIVERY'
    || Number(deliveryRequests.rows[0]?.total) > 0
    || !shipment) return;
  if (shipment.status !== 'PENDING') {
    throw new AppError('Receiving method cannot be changed after shipment has started', 409);
  }
  await client.query(
    `UPDATE shipments SET status = 'CANCELLED' WHERE shipment_id = $1`,
    [shipment.shipment_id],
  );
}

async function create(sessionId, data, actor) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sessionResult = await client.query(
       `SELECT s.session_id, s.status, s.harvest_status, s.harvest_ready_at,
               oi.order_id, o.user_id AS customer_id,
               u.full_name AS customer_name, u.phone AS customer_phone
       FROM cultivation_sessions s
       INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
       INNER JOIN orders o ON o.order_id = oi.order_id
       INNER JOIN users u ON u.user_id = o.user_id
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
    if (data.harvestMethod === 'PICKUP') {
      assertCustomerPickupSchedule(data.scheduledAt, isStaff(actor) ? new Date() : session.harvest_ready_at);
    }
    const deliveryAddress = await resolveDeliveryAddress(client, data, session.customer_id);
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
    if (data.harvestMethod === 'DELIVERY') {
      await syncDeliveryShipment(client, session, data.harvestMethod, deliveryAddress);
    }
    await client.query(
      `UPDATE harvests
       SET harvest_request_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $1 AND harvest_request_id IS NULL`,
      [sessionId, result.rows[0].harvest_request_id],
    );
    await notifyReceivingMethod(
      client,
      session.customer_id,
      sessionId,
      data.harvestMethod,
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

    if (isStaff(actor) && data.harvestMethod === 'PICKUP') {
      assertCustomerPickupSchedule(data.scheduledAt, new Date());
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
    await syncDeliveryShipment(
      client,
      request,
      data.harvestMethod,
      deliveryAddress,
      request.harvest_method,
    );
    await client.query(
      `UPDATE harvests
       SET harvest_request_id = $2, updated_at = CURRENT_TIMESTAMP
       WHERE session_id = $1 AND harvest_request_id IS NULL`,
      [request.session_id, harvestRequestId],
    );
    const previousScheduledAt = request.scheduled_at
      ? new Date(request.scheduled_at).getTime()
      : null;
    const nextScheduledAt = data.scheduledAt
      ? new Date(data.scheduledAt).getTime()
      : null;
    if (
      request.harvest_method !== data.harvestMethod ||
      previousScheduledAt !== nextScheduledAt
    ) {
      await notifyReceivingMethod(
        client,
        request.customer_id,
        request.session_id,
        data.harvestMethod,
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
    } else if (request.harvest_method === 'DELIVERY') {
      if (!isStaff(actor)) throw new AppError('Farm Operator must confirm external delivery', 403);
    } else {
      throw new AppError('Invalid receiving method', 409);
    }
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
      [harvestRequestId, actor.user_id],
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
    await client.query('COMMIT');
    return result.rows[0];
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

module.exports = { create, update, complete, findAllForAdmin };
