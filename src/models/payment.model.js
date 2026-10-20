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
  console.warn('PayOS payment was not processed', {
    orderCode,
    paidAmount,
    reason,
    ...details,
  });
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
      console.warn('PayOS money received for cancelled order', { orderCode, paidAmount: receivedAmount });
      await client.query('COMMIT');
      return paidPayment;
    }

    await client.query(
      `UPDATE orders
       SET payment_status = 'PAID', status = 'CONFIRMED'
       WHERE order_id = $1 AND status = 'PENDING'`,
      [payment.order_id],
    );

    await client.query(
      `INSERT INTO rentals (
         order_id, user_id, duration_days, status
       )
       SELECT o.order_id, o.user_id, rp.duration_days, 'CONFIRMED'
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.order_id AND oi.item_type = 'RENTAL'
       INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
       WHERE o.order_id = $1
         AND o.payment_status = 'PAID'
       ON CONFLICT (order_id) DO NOTHING`,
      [payment.order_id],
    );

    await client.query('COMMIT');
    if (receivedAmount > expectedAmount) {
      console.warn('PayOS payment received an overpayment', {
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
