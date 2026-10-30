const pool = require('../config/db');
const AppError = require('../utils/app-error');

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
  payos_qr_code
`;

function toPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toPaymentAmount(value) {
  const amount = Math.round(Number(value));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function toExpiryMinutes(value) {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
}

function warnUnprocessedPayosPayment(orderCode, paidAmount, reason, details = {}) {
  const reasons = {
    invalid_order_code: 'mã đơn hàng không hợp lệ',
    payment_not_found: 'không tìm thấy thanh toán',
    order_not_found: 'không tìm thấy đơn hàng',
    invalid_paid_amount: 'số tiền đã thanh toán không hợp lệ',
    insufficient_paid_amount: 'số tiền đã thanh toán chưa đủ',
    payment_not_payable: 'thanh toán không ở trạng thái có thể xử lý',
    order_not_payable: 'đơn hàng không ở trạng thái có thể thanh toán',
    payment_update_conflict: 'xung đột khi cập nhật thanh toán',
  };
  console.warn(`Thanh toán PayOS chưa được xử lý: ${reasons[reason] || 'chưa xác định nguyên nhân'}`, {
    orderCode,
    paidAmount,
    reason,
    ...details,
  });
}

async function renewTrayReservations(client, orderId, expiryMinutes) {
  const itemsResult = await client.query(
    `SELECT order_item_id, quantity
     FROM order_items
     WHERE order_id = $1 AND rental_package_id IS NOT NULL AND mushroom_type_id IS NOT NULL
     ORDER BY order_item_id
     FOR UPDATE`,
    [orderId],
  );
  if (itemsResult.rows.length === 0) {
    throw new AppError('Order has no cultivation items to fulfill', 409);
  }

  for (const item of itemsResult.rows) {
    const availableTraysResult = await client.query(
      `SELECT t.tray_id
       FROM cultivation_trays t
       INNER JOIN cultivation_floors f ON f.floor_id = t.floor_id
       WHERE t.status = 'AVAILABLE' AND f.status = 'ACTIVE'
       ORDER BY t.tray_id
       FOR UPDATE OF t`,
    );
    const heldTraysResult = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS quantity
       FROM tray_reservations
       WHERE status = 'HELD'
         AND expires_at > CURRENT_TIMESTAMP
         AND order_item_id <> $1`,
      [item.order_item_id],
    );
    const availableQuantity = availableTraysResult.rows.length
      - Number(heldTraysResult.rows[0]?.quantity || 0);
    if (availableQuantity < Number(item.quantity)) {
      throw new AppError(
        `Only ${Math.max(availableQuantity, 0)} cultivation trays remain available for this order`,
        409,
      );
    }

    const reservationResult = await client.query(
      `UPDATE tray_reservations
       SET quantity = $2,
           status = 'HELD',
           expires_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'),
           released_at = NULL
       WHERE reservation_id = (
         SELECT reservation_id
         FROM tray_reservations
         WHERE order_item_id = $1
         ORDER BY reservation_id DESC
         LIMIT 1
         FOR UPDATE
       )
       RETURNING reservation_id`,
      [item.order_item_id, item.quantity, expiryMinutes],
    );
    if (reservationResult.rows.length === 0) {
      await client.query(
        `INSERT INTO tray_reservations (order_item_id, quantity, expires_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 minute'))`,
        [item.order_item_id, item.quantity, expiryMinutes],
      );
    }
  }
}

async function createOrGetPayosPayment(orderId, userId, maxAgeMinutes) {
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

    const reusablePaymentResult = await client.query(
      `SELECT ${paymentColumns}
       FROM payments
       WHERE order_id = $1
         AND payment_method = $2
         AND status = 'PENDING'
         AND payos_checkout_url IS NOT NULL
         AND created_at >= NOW() - ($3 * INTERVAL '1 minute')
       ORDER BY payment_id DESC
       LIMIT 1
       FOR UPDATE`,
      [orderId, PAYOS_PAYMENT_METHOD, toExpiryMinutes(maxAgeMinutes)],
    );
    const reusablePayment = reusablePaymentResult.rows[0];

    if (reusablePayment) {
      await client.query('COMMIT');
      return { payment: reusablePayment, reused: true };
    }

    await renewTrayReservations(client, orderId, toExpiryMinutes(maxAgeMinutes));

    const amount = toPaymentAmount(order.total_amount);
    if (!amount) {
      throw new AppError('Order total must be a positive whole VND amount', 400);
    }

    const paymentResult = await client.query(
      `INSERT INTO payments (order_id, amount, payment_method, status)
       VALUES ($1, $2, $3, 'PENDING')
       RETURNING ${paymentColumns}`,
      [orderId, amount, PAYOS_PAYMENT_METHOD],
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

async function savePayosPaymentLink(paymentId, { paymentLinkId, checkoutUrl, qrCode }) {
  const result = await pool.query(
    `UPDATE payments
     SET payos_payment_link_id = $2,
         payos_checkout_url = $3,
         payos_qr_code = $4
     WHERE payment_id = $1
       AND payment_method = $5
       AND status = 'PENDING'
     RETURNING ${paymentColumns}`,
    [paymentId, paymentLinkId || null, checkoutUrl || null, qrCode || null, PAYOS_PAYMENT_METHOD],
  );

  return result.rows[0] || null;
}

async function markPayosPaymentFailed(orderCode) {
  const paymentId = toPositiveInteger(orderCode);
  if (!paymentId) return null;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const paymentResult = await client.query(
      `SELECT p.payment_id, p.order_id, p.status
       FROM payments p
       INNER JOIN orders o ON o.order_id = p.order_id
       WHERE p.payment_id = $1 AND p.payment_method = $2
       FOR UPDATE OF p, o`,
      [paymentId, PAYOS_PAYMENT_METHOD],
    );
    const payment = paymentResult.rows[0];

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

    const paymentResult = await client.query(
      `SELECT ${paymentColumns}
       FROM payments
       WHERE payment_id = $1 AND payment_method = $2
       FOR UPDATE`,
      [paymentId, PAYOS_PAYMENT_METHOD],
    );
    const payment = paymentResult.rows[0];

    if (!payment) {
      warnUnprocessedPayosPayment(orderCode, paidAmount, 'payment_not_found');
      await client.query('COMMIT');
      return null;
    }

    const orderResult = await client.query(
      `SELECT order_id, status, payment_status
       FROM orders
       WHERE order_id = $1
       FOR UPDATE`,
      [payment.order_id],
    );
    const order = orderResult.rows[0];

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

    if (order.status !== 'PENDING' && order.status !== 'CANCELLED') {
      warnUnprocessedPayosPayment(orderCode, receivedAmount, 'order_not_payable', {
        orderStatus: order.status,
        orderPaymentStatus: order.payment_status,
      });
      await client.query('COMMIT');
      return null;
    }

    const paidPaymentResult = await client.query(
      `UPDATE payments
       SET status = 'PAID',
           paid_at = CURRENT_TIMESTAMP,
           transaction_code = $2
       WHERE payment_id = $1
         AND status IN ('PENDING', 'CANCELLED', 'FAILED')
       RETURNING ${paymentColumns}`,
      [payment.payment_id, reference == null ? null : String(reference)],
    );
    const paidPayment = paidPaymentResult.rows[0];

    if (!paidPayment) {
      warnUnprocessedPayosPayment(orderCode, receivedAmount, 'payment_update_conflict');
      await client.query('COMMIT');
      return null;
    }

    if (order.status === 'CANCELLED') {
      console.warn('Đã nhận tiền PayOS cho đơn hàng đã hủy', { orderCode, paidAmount: receivedAmount });
      await client.query('COMMIT');
      return paidPayment;
    }

    await client.query(
      `UPDATE orders
       SET payment_status = 'PAID', status = 'CONFIRMED'
       WHERE order_id = $1 AND status = 'PENDING'`,
      [payment.order_id],
    );

    const orderItemsResult = await client.query(
      `SELECT oi.order_item_id, oi.quantity, oi.mushroom_type_id,
              rp.duration_days
       FROM order_items oi
       INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
       WHERE oi.order_id = $1
         AND oi.rental_package_id IS NOT NULL
         AND oi.mushroom_type_id IS NOT NULL
       ORDER BY oi.order_item_id
       FOR UPDATE OF oi`,
      [payment.order_id],
    );
    if (orderItemsResult.rows.length === 0) {
      throw new AppError('Paid order has no cultivation items to fulfill', 409);
    }

    for (const item of orderItemsResult.rows) {
      const existingSessionResult = await client.query(
        `SELECT session_id
         FROM cultivation_sessions
         WHERE order_item_id = $1
         LIMIT 1
         FOR UPDATE`,
        [item.order_item_id],
      );
      if (existingSessionResult.rows.length > 0) continue;

      const reservationResult = await client.query(
        `SELECT reservation_id, quantity, status
         FROM tray_reservations
         WHERE order_item_id = $1 AND status IN ('HELD', 'EXPIRED')
         ORDER BY reservation_id DESC
         LIMIT 1
         FOR UPDATE`,
        [item.order_item_id],
      );
      const reservation = reservationResult.rows[0];
      if (!reservation
        || !['HELD', 'EXPIRED'].includes(reservation.status)
        || Number(reservation.quantity) !== Number(item.quantity)) {
        throw new AppError('Cultivation tray reservation is missing or does not match the order', 409);
      }

      const traysResult = await client.query(
        `SELECT t.tray_id
         FROM cultivation_trays t
         INNER JOIN cultivation_floors f ON f.floor_id = t.floor_id
         WHERE t.status = 'AVAILABLE' AND f.status = 'ACTIVE'
         ORDER BY t.tray_id
         FOR UPDATE OF t`,
      );
      const otherReservationsResult = await client.query(
        `SELECT COALESCE(SUM(quantity), 0)::int AS quantity
         FROM tray_reservations
         WHERE status = 'HELD'
           AND expires_at > CURRENT_TIMESTAMP
           AND order_item_id <> $1`,
        [item.order_item_id],
      );
      const availableForOrder = traysResult.rows.length
        - Number(otherReservationsResult.rows[0]?.quantity || 0);
      if (availableForOrder < Number(item.quantity)) {
        throw new AppError('Reserved cultivation trays are no longer available', 409);
      }
      const reclaimedReservationResult = await client.query(
        `UPDATE tray_reservations
         SET status = 'HELD',
             expires_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
             released_at = NULL
         WHERE reservation_id = $1 AND status IN ('HELD', 'EXPIRED')
         RETURNING reservation_id`,
        [reservation.reservation_id],
      );
      if (reclaimedReservationResult.rows.length === 0) {
        throw new AppError('Cultivation tray reservation could not be reclaimed', 409);
      }
      const assignedTrays = traysResult.rows.slice(0, Number(item.quantity));

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

      for (const tray of assignedTrays) {
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
         WHERE reservation_id = $1`,
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
         SELECT user_id, 'CULTIVATION_STARTED', 'Phiên trồng trọt đã bắt đầu',
                'Nấm của bạn đã được đưa vào khay trồng.',
                'CULTIVATION_SESSION', $2
         FROM orders
         WHERE order_id = $1`,
        [payment.order_id, session.session_id],
      );
    }

    await client.query(
      `UPDATE orders
       SET status = 'PROCESSING'
       WHERE order_id = $1 AND status = 'CONFIRMED'`,
      [payment.order_id],
    );

    await client.query('COMMIT');
    if (receivedAmount > expectedAmount) {
      console.warn('Số tiền thanh toán PayOS nhận được vượt quá số tiền cần thanh toán', {
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

async function expireStalePayosPayments(maxAgeMinutes) {
  const client = await pool.connect();
  const expiryMinutes = toExpiryMinutes(maxAgeMinutes) + 1;

  try {
    await client.query('BEGIN');

    const stalePaymentsResult = await client.query(
      `SELECT p.payment_id, p.order_id
       FROM payments p
       INNER JOIN orders o ON o.order_id = p.order_id
       WHERE p.payment_method = $1
         AND p.status = 'PENDING'
         AND p.created_at < NOW() - ($2 * INTERVAL '1 minute')
         AND o.status = 'PENDING'
         AND o.payment_status = 'PENDING'
       FOR UPDATE OF p, o`,
      [PAYOS_PAYMENT_METHOD, expiryMinutes],
    );

    let processedCount = 0;
    for (const stalePayment of stalePaymentsResult.rows) {
      const paymentResult = await client.query(
        `UPDATE payments
         SET status = 'CANCELLED'
         WHERE payment_id = $1 AND status = 'PENDING'
         RETURNING payment_id`,
        [stalePayment.payment_id],
      );

      if (paymentResult.rows.length === 0) continue;

      await client.query(
        `UPDATE orders
         SET payment_status = 'FAILED'
         WHERE order_id = $1
           AND status = 'PENDING'
           AND payment_status = 'PENDING'`,
        [stalePayment.order_id],
      );
      await client.query(
        `UPDATE tray_reservations
         SET status = 'EXPIRED', released_at = CURRENT_TIMESTAMP
         WHERE status = 'HELD'
           AND order_item_id IN (
             SELECT order_item_id FROM order_items WHERE order_id = $1
           )`,
        [stalePayment.order_id],
      );
      processedCount += paymentResult.rows.length;
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

  return {
    order,
    payment: paymentResult.rows[0] || null,
  };
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
