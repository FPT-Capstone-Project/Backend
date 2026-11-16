const pool = require('../config/db');
const AppError = require('../utils/app-error');

async function create(shipmentData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      'SELECT order_id FROM orders WHERE order_id = $1 FOR UPDATE',
      [shipmentData.orderId],
    );
    if (!orderResult.rows[0]) throw new AppError('Order not found', 404);

    const existingResult = await client.query(
      `SELECT shipment_id
       FROM shipments
       WHERE order_id = $1 AND status IN ('PENDING', 'SHIPPED', 'IN_TRANSIT')
       FOR UPDATE`,
      [shipmentData.orderId],
    );
    if (existingResult.rows[0]) {
      throw new AppError('An active shipment already exists for this order', 409);
    }

    const result = await client.query(
      `INSERT INTO shipments (
         order_id, address, recipient_name, recipient_phone, shipping_fee,
         carrier, tracking_code, status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
       RETURNING *`,
      [
        shipmentData.orderId,
        shipmentData.address,
        shipmentData.recipientName,
        shipmentData.recipientPhone,
        shipmentData.shippingFee,
        shipmentData.carrier,
        shipmentData.trackingCode,
      ],
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      throw new AppError('An active shipment already exists for this order', 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

async function findAllForAdmin() {
  const result = await pool.query(
    `SELECT sh.shipment_id, sh.order_id,
            CONCAT('ORD-', sh.order_id) AS order_code,
            u.user_id AS customer_id, u.full_name AS customer_name,
            sh.address, sh.recipient_name, sh.recipient_phone, sh.shipping_fee,
            sh.carrier, sh.tracking_code, sh.status, sh.shipped_at, sh.delivered_at
     FROM shipments sh
     INNER JOIN orders o ON o.order_id = sh.order_id
     INNER JOIN users u ON u.user_id = o.user_id
     ORDER BY sh.shipment_id DESC`,
  );
  return { shipments: result.rows, total: result.rows.length };
}

async function findAllForOrder(orderId, actor) {
  const orderResult = await pool.query(
    'SELECT order_id, user_id FROM orders WHERE order_id = $1',
    [orderId],
  );
  const order = orderResult.rows[0];
  if (!order || (Number(actor.role_id) === 3 && Number(order.user_id) !== Number(actor.user_id))) {
    throw new AppError('Order not found', 404);
  }

  const result = await pool.query(
    `SELECT shipment_id, order_id, address, recipient_name, recipient_phone,
            shipping_fee, carrier, tracking_code, status, shipped_at, delivered_at
     FROM shipments
     WHERE order_id = $1
     ORDER BY shipment_id DESC`,
    [orderId],
  );
  return { orderId, shipments: result.rows, total: result.rows.length };
}

async function updateStatus(shipmentId, status) {
  const result = await pool.query(
    `UPDATE shipments
     SET status = $2,
         shipped_at = CASE
           WHEN $2 = 'PENDING' THEN NULL
           WHEN $2 IN ('SHIPPED', 'IN_TRANSIT', 'DELIVERED') THEN COALESCE(shipped_at, CURRENT_TIMESTAMP)
           ELSE shipped_at
         END,
         delivered_at = CASE
           WHEN $2 = 'DELIVERED' THEN COALESCE(delivered_at, CURRENT_TIMESTAMP)
           WHEN $2 = 'RETURNED' THEN delivered_at
           ELSE NULL
         END
     WHERE shipment_id = $1
     RETURNING *`,
    [shipmentId, status],
  );
  if (!result.rows[0]) throw new AppError('Shipment not found', 404);
  return result.rows[0];
}

module.exports = { create, findAllForAdmin, findAllForOrder, updateStatus };
