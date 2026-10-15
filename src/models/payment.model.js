const pool = require('../config/db');
const AppError = require('../utils/app-error');

const SEPAY_PAYMENT_METHOD = 'SEPAY_QR';
const paymentColumns = `
  payment_id,
  order_id,
  amount,
  payment_method,
  transaction_code,
  status,
  paid_at,
  created_at
`;

function buildPaymentCode(orderId, paymentId) {
  return `SP${orderId}P${paymentId}`;
}

function isPositiveWholeVnd(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0;
}

async function createOrGetSepayPayment(orderId, userId) {
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
    if (!isPositiveWholeVnd(order.total_amount)) {
      throw new AppError('Order total must be a positive whole VND amount', 400);
    }

    const existingResult = await client.query(
      `SELECT ${paymentColumns}
       FROM payments
       WHERE order_id = $1 AND payment_method = $2 AND status = 'PENDING'
       ORDER BY payment_id DESC
       LIMIT 1
       FOR UPDATE`,
      [orderId, SEPAY_PAYMENT_METHOD],
    );
    let payment = existingResult.rows[0];

    if (!payment) {
      const paymentResult = await client.query(
        `INSERT INTO payments (order_id, amount, payment_method, status)
         VALUES ($1, $2, $3, 'PENDING')
         RETURNING ${paymentColumns}`,
        [orderId, order.total_amount, SEPAY_PAYMENT_METHOD],
      );

      const createdPayment = paymentResult.rows[0];
      const codeResult = await client.query(
        `UPDATE payments
         SET transaction_code = $1
         WHERE payment_id = $2
         RETURNING ${paymentColumns}`,
        [buildPaymentCode(orderId, createdPayment.payment_id), createdPayment.payment_id],
      );
      payment = codeResult.rows[0];
    }

    await client.query(
      `UPDATE orders
       SET payment_status = 'PENDING'
       WHERE order_id = $1`,
      [orderId],
    );

    await client.query('COMMIT');
    return payment;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function markSepayPaymentAsPaid(paymentCode, transferAmount) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const paymentResult = await client.query(
      `SELECT p.payment_id, p.order_id, p.amount, p.payment_method,
              p.transaction_code, p.status, p.paid_at, p.created_at,
              o.status AS order_status, o.payment_status AS order_payment_status
       FROM payments p
       INNER JOIN orders o ON o.order_id = p.order_id
       WHERE p.transaction_code = $1 AND p.payment_method = $2
       FOR UPDATE OF p, o`,
      [paymentCode, SEPAY_PAYMENT_METHOD],
    );
    const payment = paymentResult.rows[0];

    if (!payment || payment.status === 'PAID') {
      await client.query('COMMIT');
      return payment || null;
    }

    if (
      payment.status !== 'PENDING'
      || payment.order_status !== 'PENDING'
      || payment.order_payment_status === 'PAID'
      || !Number.isSafeInteger(transferAmount)
      || transferAmount < Number(payment.amount)
    ) {
      await client.query('COMMIT');
      return null;
    }

    const paidPaymentResult = await client.query(
      `UPDATE payments
       SET status = 'PAID', paid_at = CURRENT_TIMESTAMP
       WHERE payment_id = $1 AND status = 'PENDING'
       RETURNING ${paymentColumns}`,
      [payment.payment_id],
    );
    const paidPayment = paidPaymentResult.rows[0];

    if (!paidPayment) {
      await client.query('COMMIT');
      return null;
    }

    await client.query(
      `UPDATE orders
       SET payment_status = 'PAID', status = 'PAID'
       WHERE order_id = $1`,
      [payment.order_id],
    );

    await client.query('COMMIT');
    return paidPayment;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function findSepayPaymentStatus(orderId, userId) {
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
    `SELECT payment_id, order_id, amount, payment_method,
            transaction_code, status, paid_at
     FROM payments
     WHERE order_id = $1 AND payment_method = $2
     ORDER BY payment_id DESC
     LIMIT 1`,
    [orderId, SEPAY_PAYMENT_METHOD],
  );

  return {
    order,
    payment: paymentResult.rows[0] || null,
  };
}

module.exports = {
  SEPAY_PAYMENT_METHOD,
  createOrGetSepayPayment,
  markSepayPaymentAsPaid,
  findSepayPaymentStatus,
};
