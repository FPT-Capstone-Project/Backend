const pool = require('../config/db');
const AppError = require('../utils/app-error');
const {
  assertCultivationCapacity,
  findLatestReservationForUpdate,
  isActiveReservation,
  renewReservation,
  requiredSpawnForTrays,
  toHoldMinutes,
} = require('./cultivationReservation.model');

const PAYOS_PAYMENT_METHOD = 'PAYOS';
const paymentColumns = `
  payment_id,
  order_id,
  amount,
  payment_method,
  transaction_code,
  status,
  paid_at,
  created_at,
  payos_payment_link_id,
  payos_checkout_url,
  payos_qr_code,
  expires_at,
  FLOOR(EXTRACT(EPOCH FROM expires_at))::bigint AS expires_at_epoch
`;

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toPaymentAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function earlierDate(first, second) {
  const date = toDate(second);
  return !date || (first && first <= date) ? first : date;
}

function isInsufficientCapacity(error) {
  return error && ['INSUFFICIENT_TRAYS', 'INSUFFICIENT_SPAWN'].includes(error.code);
}

function warnUnprocessedPayosPayment(orderCode, paidAmount, reason, details = {}) {
  console.warn('PayOS payment was not processed', {
    orderCode,
    paidAmount,
    reason,
    ...details,
  });
}

async function lockPayosOrderAndPayment(client, paymentId) {
  const paymentOrderResult = await client.query(
    `SELECT order_id
     FROM payments
     WHERE payment_id = $1 AND payment_method = $2`,
    [paymentId, PAYOS_PAYMENT_METHOD],
  );
  const paymentOrder = paymentOrderResult.rows[0];
  if (!paymentOrder) return { payment: null, order: null };

  const orderResult = await client.query(
    `SELECT order_id, status, payment_status
     FROM orders
     WHERE order_id = $1
     FOR UPDATE`,
    [paymentOrder.order_id],
  );
  const order = orderResult.rows[0] || null;
  if (!order) return { payment: null, order: null };

  const paymentResult = await client.query(
    `SELECT ${paymentColumns}
     FROM payments
     WHERE payment_id = $1
       AND payment_method = $2
       AND order_id = $3
     FOR UPDATE`,
    [paymentId, PAYOS_PAYMENT_METHOD, order.order_id],
  );
  return { payment: paymentResult.rows[0] || null, order };
}

async function findCultivationItemsForUpdate(client, orderId) {
  const result = await client.query(
    `SELECT oi.order_item_id, oi.quantity, oi.mushroom_type_id, rp.duration_days
     FROM order_items oi
     INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
     WHERE oi.order_id = $1
       AND oi.rental_package_id IS NOT NULL
       AND oi.mushroom_type_id IS NOT NULL
     ORDER BY oi.order_item_id
     FOR UPDATE OF oi`,
    [orderId],
  );
  return result.rows;
}

async function refreshCultivationReservations(client, orderId, holdMinutes) {
  const items = await findCultivationItemsForUpdate(client, orderId);
  if (items.length === 0) throw new AppError('Order has no cultivation items to fulfill', 409);

  let holdExpiresAt = null;
  for (const item of items) {
    const spawnQuantity = requiredSpawnForTrays(item.quantity);
    await assertCultivationCapacity(client, {
      orderItemId: item.order_item_id,
      mushroomTypeId: item.mushroom_type_id,
      trayQuantity: item.quantity,
      spawnQuantity,
    });
    const reservation = await renewReservation(client, {
      orderItemId: item.order_item_id,
      trayQuantity: item.quantity,
      spawnQuantity,
      holdMinutes: toHoldMinutes(holdMinutes),
    });
    holdExpiresAt = earlierDate(holdExpiresAt, reservation.expires_at);
  }

  if (!holdExpiresAt) throw new AppError('Cultivation reservation could not be created', 409);
  return holdExpiresAt;
}

async function verifyActiveCultivationReservations(client, orderId) {
  const items = await findCultivationItemsForUpdate(client, orderId);
  if (items.length === 0) throw new AppError('Order has no cultivation items to fulfill', 409);

  let holdExpiresAt = null;
  for (const item of items) {
    const spawnQuantity = requiredSpawnForTrays(item.quantity);
    const reservation = await findLatestReservationForUpdate(client, item.order_item_id);
    if (!reservation
      || reservation.status !== 'HELD'
      || !isActiveReservation(reservation)
      || Number(reservation.quantity) !== Number(item.quantity)
      || Number(reservation.spawn_quantity) !== spawnQuantity) {
      return null;
    }
    await assertCultivationCapacity(client, {
      orderItemId: item.order_item_id,
      mushroomTypeId: item.mushroom_type_id,
      trayQuantity: item.quantity,
      spawnQuantity,
    });
    holdExpiresAt = earlierDate(holdExpiresAt, reservation.expires_at);
  }
  return holdExpiresAt;
}

async function createOrGetPayosPayment(orderId, userId, holdMinutes) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `SELECT order_id, total_amount, status, payment_status
       FROM orders
       WHERE order_id = $1 AND user_id = $2
       FOR UPDATE`,
      [orderId, userId],
    );
    const order = orderResult.rows[0];

    if (!order) throw new AppError('Order not found', 404);
    if (order.payment_status === 'PAID') throw new AppError('Order has already been paid', 409);
    if (order.status !== 'PENDING') throw new AppError('Only pending orders can be paid', 409);
    if (!['UNPAID', 'PENDING', 'FAILED'].includes(order.payment_status)) {
      throw new AppError('Order is not eligible for payment', 409);
    }

    const activeHoldExpiresAt = await verifyActiveCultivationReservations(client, orderId);
    if (activeHoldExpiresAt) {
      const reusablePaymentResult = await client.query(
        `SELECT ${paymentColumns}
         FROM payments
         WHERE order_id = $1
           AND payment_method = $2
           AND status = 'PENDING'
           AND payos_checkout_url IS NOT NULL
           AND expires_at IS NOT NULL
           AND expires_at > CURRENT_TIMESTAMP
           AND expires_at <= $3
         ORDER BY payment_id DESC
         LIMIT 1
         FOR UPDATE`,
        [orderId, PAYOS_PAYMENT_METHOD, activeHoldExpiresAt],
      );
      const reusablePayment = reusablePaymentResult.rows[0];
      if (reusablePayment) {
        await client.query('COMMIT');
        return { payment: reusablePayment, reused: true };
      }
    }

    const holdExpiresAt = await refreshCultivationReservations(client, orderId, holdMinutes);

    const amount = toPaymentAmount(order.total_amount);
    if (!amount) throw new AppError('Order total must be a positive whole VND amount', 400);

    const paymentResult = await client.query(
      `INSERT INTO payments (order_id, amount, payment_method, status, expires_at)
       VALUES ($1, $2, $3, 'PENDING', $4)
       RETURNING ${paymentColumns}`,
      [orderId, amount, PAYOS_PAYMENT_METHOD, holdExpiresAt],
    );
    const payment = paymentResult.rows[0];
    await client.query(
      `UPDATE orders
       SET payment_status = 'PENDING'
       WHERE order_id = $1`,
      [orderId],
    );

    await client.query('COMMIT');
    return { payment, reused: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function savePayosPaymentLink(paymentId, {
  paymentLinkId,
  checkoutUrl,
  qrCode,
  expiresAt,
}) {
  const expiry = toDate(expiresAt);
  if (!expiry) throw new AppError('Payment link expiry is invalid', 500);

  const result = await pool.query(
    `UPDATE payments p
     SET payos_payment_link_id = $2,
         payos_checkout_url = $3,
         payos_qr_code = $4,
         expires_at = $5
     WHERE p.payment_id = $1
       AND p.payment_method = $6
       AND p.status = 'PENDING'
       AND p.expires_at >= $5
       AND $5 > CURRENT_TIMESTAMP
       AND EXISTS (
         SELECT 1
         FROM order_items oi
         INNER JOIN tray_reservations tr ON tr.order_item_id = oi.order_item_id
         WHERE oi.order_id = p.order_id
           AND tr.status = 'HELD'
           AND tr.expires_at >= $5
       )
     RETURNING ${paymentColumns}`,
    [paymentId, paymentLinkId || null, checkoutUrl || null, qrCode || null, expiry, PAYOS_PAYMENT_METHOD],
  );
  return result.rows[0] || null;
}

async function markPayosPaymentFailed(orderCode) {
  const paymentId = toPositiveInteger(orderCode);
  if (!paymentId) return null;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const { payment } = await lockPayosOrderAndPayment(client, paymentId);
    if (!payment || payment.status !== 'PENDING') {
      await client.query('COMMIT');
      return null;
    }

    const failedPaymentResult = await client.query(
      `UPDATE payments
       SET status = 'FAILED'
       WHERE payment_id = $1 AND status = 'PENDING'
       RETURNING ${paymentColumns}`,
      [payment.payment_id],
    );
    const failedPayment = failedPaymentResult.rows[0] || null;
    if (failedPayment) {
      await client.query(
        `UPDATE orders
         SET payment_status = 'FAILED'
         WHERE order_id = $1
           AND status = 'PENDING'
           AND payment_status = 'PENDING'`,
        [payment.order_id],
      );
    }

    await client.query('COMMIT');
    return failedPayment;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getFulfillmentPlan(client, orderId) {
  const items = await findCultivationItemsForUpdate(client, orderId);
  if (items.length === 0) return { canFulfill: false, plans: [] };

  const plans = [];
  for (const item of items) {
    const existingSessionResult = await client.query(
      `SELECT session_id
       FROM cultivation_sessions
       WHERE order_item_id = $1
       LIMIT 1
       FOR UPDATE`,
      [item.order_item_id],
    );
    if (existingSessionResult.rows.length > 0) continue;

    let reservation = await findLatestReservationForUpdate(client, item.order_item_id);
    const spawnQuantity = requiredSpawnForTrays(item.quantity);
    if (!reservation
      || !['HELD', 'EXPIRED'].includes(reservation.status)
      || Number(reservation.quantity) !== Number(item.quantity)
      || Number(reservation.spawn_quantity) !== spawnQuantity) {
      return { canFulfill: false, plans: [] };
    }

    if (reservation.status === 'HELD' && !isActiveReservation(reservation)) {
      await client.query(
        `UPDATE tray_reservations
         SET status = 'EXPIRED', released_at = CURRENT_TIMESTAMP
         WHERE reservation_id = $1 AND status = 'HELD'`,
        [reservation.reservation_id],
      );
      reservation = { ...reservation, status: 'EXPIRED', is_active: false };
    }

    try {
      const capacity = await assertCultivationCapacity(client, {
        orderItemId: item.order_item_id,
        mushroomTypeId: item.mushroom_type_id,
        trayQuantity: item.quantity,
        spawnQuantity,
      });
      plans.push({ item, reservation, capacity, spawnQuantity });
    } catch (error) {
      if (isInsufficientCapacity(error)) return { canFulfill: false, plans: [] };
      throw error;
    }
  }
  return { canFulfill: true, plans };
}

async function markPaymentReceived(client, payment, reference) {
  const result = await client.query(
    `UPDATE payments
     SET status = 'PAID',
         paid_at = CURRENT_TIMESTAMP,
         transaction_code = $2
     WHERE payment_id = $1
       AND status IN ('PENDING', 'CANCELLED', 'FAILED')
     RETURNING ${paymentColumns}`,
    [payment.payment_id, reference == null ? null : String(reference)],
  );
  return result.rows[0] || null;
}

async function markOrderRefundPending(client, orderId) {
  await client.query(
    `UPDATE orders
     SET payment_status = 'REFUND_PENDING'
     WHERE order_id = $1 AND status <> 'CANCELLED'`,
    [orderId],
  );
  await client.query(
    `UPDATE tray_reservations
     SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
     WHERE status = 'HELD'
       AND order_item_id IN (
         SELECT order_item_id FROM order_items WHERE order_id = $1
       )`,
    [orderId],
  );
  await client.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, reference_type, reference_id
     )
     SELECT user_id, 'PAYMENT_REFUND_REQUIRED', 'Payment received - refund required',
            'Your payment was received after the cultivation hold expired and the required resources are no longer available. Our team will process your refund.',
            'ORDER', $1
     FROM orders
     WHERE order_id = $1`,
    [orderId],
  );
}

async function hasAnotherPaidPayment(client, orderId, paymentId) {
  const result = await client.query(
    `SELECT payment_id
     FROM payments
     WHERE order_id = $1
       AND payment_method = $2
       AND status = 'PAID'
       AND payment_id <> $3
     LIMIT 1`,
    [orderId, PAYOS_PAYMENT_METHOD, paymentId],
  );
  return Boolean(result.rows[0]);
}

async function hasNewerPaymentAttempt(client, orderId, paymentId) {
  const result = await client.query(
    `SELECT payment_id
     FROM payments
     WHERE order_id = $1
       AND payment_method = $2
       AND payment_id > $3
     LIMIT 1`,
    [orderId, PAYOS_PAYMENT_METHOD, paymentId],
  );
  return Boolean(result.rows[0]);
}

async function fulfillCultivationPlan(client, orderId, plan) {
  const { item, reservation, capacity, spawnQuantity } = plan;
  const protocolResult = await client.query(
    `SELECT protocol_id
     FROM cultivation_protocols
     WHERE mushroom_type_id = $1 AND status = 'ACTIVE'
     ORDER BY created_at DESC, protocol_id DESC
     LIMIT 1`,
    [item.mushroom_type_id],
  );
  const sessionResult = await client.query(
    `INSERT INTO cultivation_sessions (
       mushroom_type_id, start_at, duration_days, status, harvest_date,
       order_item_id, protocol_id
     )
     VALUES (
       $1, CURRENT_TIMESTAMP, $2, 'ACTIVE',
       CURRENT_DATE + $2::integer, $3, $4
     )
     RETURNING session_id, mushroom_type_id, start_at, duration_days, status, harvest_date`,
    [
      item.mushroom_type_id,
      item.duration_days,
      item.order_item_id,
      protocolResult.rows[0]?.protocol_id ?? null,
    ],
  );
  const session = sessionResult.rows[0];

  const inventoryBefore = Number(capacity.inventory.quantity);
  const inventoryUpdateResult = await client.query(
    `UPDATE spawn_inventory
     SET quantity = quantity - $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE inventory_id = $1 AND quantity >= $2
     RETURNING quantity`,
    [capacity.inventory.inventory_id, spawnQuantity],
  );
  const inventoryAfter = inventoryUpdateResult.rows[0];
  if (!inventoryAfter) throw new AppError('Spawn inventory changed while fulfilling the order', 409);
  await client.query(
    `INSERT INTO inventory_transactions (
       inventory_id, session_id, transaction_type, quantity,
       quantity_before, quantity_after, notes
     )
     VALUES ($1, $2, 'OUT', $3, $4, $5, $6)`,
    [
      capacity.inventory.inventory_id,
      session.session_id,
      spawnQuantity,
      inventoryBefore,
      Number(inventoryAfter.quantity),
      `Cultivation order ${orderId}`,
    ],
  );

  for (const tray of capacity.trays.slice(0, Number(item.quantity))) {
    const updatedTrayResult = await client.query(
      `UPDATE cultivation_trays
       SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP
       WHERE tray_id = $1 AND status = 'AVAILABLE'
       RETURNING tray_id`,
      [tray.tray_id],
    );
    if (updatedTrayResult.rows.length === 0) {
      throw new AppError('A reserved cultivation tray is no longer available', 409);
    }
    await client.query(
      `INSERT INTO cultivation_session_trays (session_id, tray_id, status)
       VALUES ($1, $2, 'ACTIVE')`,
      [session.session_id, tray.tray_id],
    );
  }

  await client.query(
    `UPDATE tray_reservations
     SET status = 'CONSUMED'
     WHERE reservation_id = $1 AND status IN ('HELD', 'EXPIRED')`,
    [reservation.reservation_id],
  );
  await client.query(
    `INSERT INTO cultivation_progress (
       session_id, current_stage, progress_percent, start_date,
       expected_harvest_date, description
     )
     VALUES ($1, 'PREPARATION', 0, CURRENT_DATE, $2::date, 'Cultivation started after payment')`,
    [session.session_id, session.harvest_date],
  );
  await client.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, reference_type, reference_id
     )
     SELECT user_id, 'CULTIVATION_STARTED', 'Cultivation has started',
            'Your mushroom spawn has been allocated to cultivation trays.',
            'CULTIVATION_SESSION', $2
     FROM orders
     WHERE order_id = $1`,
    [orderId, session.session_id],
  );
}

async function markPayosPaymentAsPaid(orderCode, paidAmount, reference) {
  const paymentId = toPositiveInteger(orderCode);
  const receivedAmount = Number(paidAmount);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    if (!paymentId) {
      warnUnprocessedPayosPayment(orderCode, paidAmount, 'invalid_order_code');
      await client.query('COMMIT');
      return null;
    }

    const { payment, order } = await lockPayosOrderAndPayment(client, paymentId);
    if (!payment) {
      warnUnprocessedPayosPayment(orderCode, paidAmount, 'payment_not_found');
      await client.query('COMMIT');
      return null;
    }

    if (!order) {
      warnUnprocessedPayosPayment(orderCode, paidAmount, 'order_not_found');
      await client.query('COMMIT');
      return null;
    }
    if (payment.status === 'PAID') {
      await client.query('COMMIT');
      return payment;
    }

    const expectedAmount = Number(payment.amount);
    if (!Number.isSafeInteger(receivedAmount) || receivedAmount <= 0) {
      warnUnprocessedPayosPayment(orderCode, paidAmount, 'invalid_paid_amount', { expectedAmount });
      await client.query('COMMIT');
      return null;
    }
    if (receivedAmount < expectedAmount) {
      warnUnprocessedPayosPayment(orderCode, receivedAmount, 'insufficient_paid_amount', {
        expectedAmount,
        shortfallAmount: expectedAmount - receivedAmount,
      });
      await client.query('COMMIT');
      return null;
    }
    if (!['PENDING', 'CANCELLED', 'FAILED'].includes(payment.status)) {
      warnUnprocessedPayosPayment(orderCode, receivedAmount, 'payment_not_payable', {
        paymentStatus: payment.status,
      });
      await client.query('COMMIT');
      return null;
    }
    if (await hasNewerPaymentAttempt(client, payment.order_id, payment.payment_id)) {
      const paidPayment = await markPaymentReceived(client, payment, reference);
      if (!paidPayment) {
        warnUnprocessedPayosPayment(orderCode, receivedAmount, 'payment_update_conflict');
        await client.query('COMMIT');
        return null;
      }
      await markOrderRefundPending(client, payment.order_id);
      await client.query('COMMIT');
      return paidPayment;
    }
    if (await hasAnotherPaidPayment(client, payment.order_id, payment.payment_id)) {
      const paidPayment = await markPaymentReceived(client, payment, reference);
      if (!paidPayment) {
        warnUnprocessedPayosPayment(orderCode, receivedAmount, 'payment_update_conflict');
        await client.query('COMMIT');
        return null;
      }
      await markOrderRefundPending(client, payment.order_id);
      await client.query('COMMIT');
      return paidPayment;
    }
    if (order.status !== 'PENDING' && order.status !== 'CANCELLED') {
      const paidPayment = await markPaymentReceived(client, payment, reference);
      if (paidPayment && order.payment_status !== 'REFUND_PENDING') {
        await markOrderRefundPending(client, payment.order_id);
      }
      await client.query('COMMIT');
      return paidPayment;
    }

    if (order.status === 'CANCELLED') {
      const paidPayment = await markPaymentReceived(client, payment, reference);
      if (!paidPayment) {
        warnUnprocessedPayosPayment(orderCode, receivedAmount, 'payment_update_conflict');
        await client.query('COMMIT');
        return null;
      }
      await client.query('COMMIT');
      return paidPayment;
    }

    const fulfillment = await getFulfillmentPlan(client, payment.order_id);
    const paidPayment = await markPaymentReceived(client, payment, reference);
    if (!paidPayment) {
      warnUnprocessedPayosPayment(orderCode, receivedAmount, 'payment_update_conflict');
      await client.query('COMMIT');
      return null;
    }
    if (!fulfillment.canFulfill) {
      await markOrderRefundPending(client, payment.order_id);
      await client.query('COMMIT');
      return paidPayment;
    }

    for (const plan of fulfillment.plans) {
      await fulfillCultivationPlan(client, payment.order_id, plan);
    }
    await client.query(
      `UPDATE orders
       SET payment_status = 'PAID', status = 'PROCESSING'
       WHERE order_id = $1 AND status = 'PENDING'`,
      [payment.order_id],
    );
    await client.query('COMMIT');
    if (receivedAmount > expectedAmount) {
      console.warn('PayOS overpayment received', {
        orderCode,
        paidAmount: receivedAmount,
        expectedAmount,
        excessAmount: receivedAmount - expectedAmount,
      });
    }
    return paidPayment;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function expireStalePayosPayments() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const staleReservationsResult = await client.query(
      `SELECT tr.reservation_id, oi.order_id
       FROM tray_reservations tr
       INNER JOIN order_items oi ON oi.order_item_id = tr.order_item_id
       WHERE tr.status = 'HELD' AND tr.expires_at <= CURRENT_TIMESTAMP`,
    );

    let processedCount = 0;
    for (const reservation of staleReservationsResult.rows) {
      await client.query(
        `SELECT order_id
         FROM orders
         WHERE order_id = $1
         FOR UPDATE`,
        [reservation.order_id],
      );
      await client.query(
        `SELECT payment_id
         FROM payments
         WHERE order_id = $1
           AND payment_method = $2
           AND status = 'PENDING'
         FOR UPDATE`,
        [reservation.order_id, PAYOS_PAYMENT_METHOD],
      );
      const lockedReservationResult = await client.query(
        `SELECT reservation_id
         FROM tray_reservations
         WHERE reservation_id = $1
           AND status = 'HELD'
           AND expires_at <= CURRENT_TIMESTAMP
         FOR UPDATE`,
        [reservation.reservation_id],
      );
      if (!lockedReservationResult.rows[0]) continue;
      const reservationResult = await client.query(
        `UPDATE tray_reservations
         SET status = 'EXPIRED', released_at = CURRENT_TIMESTAMP
         WHERE reservation_id = $1 AND status = 'HELD'
         RETURNING reservation_id`,
        [reservation.reservation_id],
      );
      if (reservationResult.rows.length === 0) continue;

      const cancelledPaymentsResult = await client.query(
        `UPDATE payments
         SET status = 'CANCELLED'
         WHERE order_id = $1
           AND payment_method = $2
           AND status = 'PENDING'
         RETURNING payment_id`,
        [reservation.order_id, PAYOS_PAYMENT_METHOD],
      );
      if (cancelledPaymentsResult.rows.length > 0) {
        await client.query(
          `UPDATE orders
           SET payment_status = 'FAILED'
           WHERE order_id = $1
             AND status = 'PENDING'
             AND payment_status = 'PENDING'`,
          [reservation.order_id],
        );
      }
      processedCount += 1;
    }

    await client.query('COMMIT');
    return processedCount;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findPayosPaymentStatus(orderId, userId) {
  const orderResult = await pool.query(
    `SELECT order_id, status, payment_status, total_amount
     FROM orders
     WHERE order_id = $1 AND user_id = $2
     LIMIT 1`,
    [orderId, userId],
  );
  const order = orderResult.rows[0] || null;
  if (!order) return { order: null, payment: null };

  const paymentResult = await pool.query(
    `SELECT ${paymentColumns}
     FROM payments
     WHERE order_id = $1 AND payment_method = $2
     ORDER BY payment_id DESC
     LIMIT 1`,
    [orderId, PAYOS_PAYMENT_METHOD],
  );
  return { order, payment: paymentResult.rows[0] || null };
}

module.exports = {
  PAYOS_PAYMENT_METHOD,
  createOrGetPayosPayment,
  savePayosPaymentLink,
  markPayosPaymentAsPaid,
  markPayosPaymentFailed,
  expireStalePayosPayments,
  findPayosPaymentStatus,
};
