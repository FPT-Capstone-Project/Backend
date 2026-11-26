const pool = require('../config/db');
const { lockRequest, completeHandover } = require('./harvestRequest.model');
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

    const session = await client.query(
      `SELECT 1 FROM cultivation_sessions s JOIN order_items oi USING (order_item_id)
       WHERE oi.order_id = $1`,
      [shipmentData.orderId],
    );
    if (session.rows.length) {
      throw new AppError('Shipments for cultivation orders are created when a delivery harvest is completed', 409);
    }

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
            sh.carrier, sh.tracking_code, sh.harvest_request_id, sh.status, sh.shipped_at, sh.delivered_at
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
            shipping_fee, carrier, tracking_code, harvest_request_id, status, shipped_at, delivered_at
     FROM shipments
     WHERE order_id = $1
     ORDER BY shipment_id DESC`,
    [orderId],
  );
  return { orderId, shipments: result.rows, total: result.rows.length };
}

async function createForHarvest(client, request) {
  await client.query('SELECT 1 FROM orders WHERE order_id = $1 FOR UPDATE', [request.order_id]);
  const existing = await client.query(
    `SELECT shipment_id, status, address FROM shipments
     WHERE order_id = $1 AND status NOT IN ('CANCELLED', 'RETURNED')
     ORDER BY shipment_id FOR UPDATE`,
    [request.order_id],
  );
  const legacy = existing.rows[0];
  if (existing.rows.length > 1 || legacy?.status === 'DELIVERED') {
    throw new AppError('Existing shipments require manual reconciliation', 409);
  }
  const address = request.delivery_address || legacy?.address;
  const phone = request.customer_phone?.trim();
  if (!address || !phone) throw new AppError('Delivery address and customer phone are required', 409);

  if (legacy) {
    if (legacy.status !== 'PENDING' && legacy.address !== address) {
      throw new AppError('Existing shipment has already shipped to a different address', 409);
    }
    await client.query(
      `UPDATE shipments SET harvest_request_id = $2, address = $3, status = 'PENDING'
       WHERE shipment_id = $1`,
      [legacy.shipment_id, request.harvest_request_id, address],
    );
    return;
  }

  await client.query(
    `INSERT INTO shipments (order_id, address, recipient_name, recipient_phone, harvest_request_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [request.order_id, address, request.customer_name, phone, request.harvest_request_id],
  );
}

async function setStatus(client, shipmentId, status, actor) {
  const result = await client.query(
    `UPDATE shipments
     SET status = $2::varchar(30),
         shipped_at = CASE
           WHEN $2::text = 'PENDING' THEN NULL
           WHEN $2::text IN ('SHIPPED', 'IN_TRANSIT') THEN COALESCE(shipped_at, CURRENT_TIMESTAMP)
           ELSE shipped_at
         END,
         delivered_at = CASE
           WHEN $2::text = 'DELIVERED' THEN COALESCE(delivered_at, CURRENT_TIMESTAMP)
           WHEN $2::text = 'RETURNED' THEN delivered_at
           ELSE NULL
         END
     WHERE shipment_id = $1::integer
     RETURNING *`,
    [shipmentId, status],
  );
  const shipment = result.rows[0];

  const labels = {
    PENDING: 'Chờ giao hàng',
    SHIPPED: 'Đã bàn giao cho đơn vị vận chuyển',
    IN_TRANSIT: 'Đang vận chuyển',
    DELIVERED: 'Đã giao hàng thành công',
    CANCELLED: 'Đã hủy giao hàng',
    RETURNED: 'Đã hoàn hàng',
  };
  await client.query(
    `INSERT INTO notifications (
       user_id, notification_type, title, message, created_by,
       reference_type, reference_id
     )
     SELECT o.user_id, 'SHIPMENT_UPDATE', 'Cập nhật trạng thái giao hàng',
            $2::text, $3::integer, 'ORDER', o.order_id
     FROM orders o
     WHERE o.order_id = $1::integer`,
    [
      shipment.order_id,
      `Đơn hàng #${shipment.order_id}: ${labels[status]}.`,
      actor?.user_id || null,
    ],
  );

  return shipment;
}

async function updateStatus(shipmentId, status, actor) {
  if (status === 'DELIVERED') throw new AppError('Customer confirmation is required', 403);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT sh.*, EXISTS (SELECT 1 FROM cultivation_sessions s
         JOIN order_items oi USING (order_item_id) WHERE oi.order_id = sh.order_id) AS cultivation
       FROM shipments sh WHERE shipment_id = $1 FOR UPDATE OF sh`,
      [shipmentId],
    );
    const shipment = current.rows[0];
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (shipment.status === status) {
      await client.query('COMMIT');
      const { cultivation, ...data } = shipment;
      return data;
    }
    if (shipment.cultivation) {
      const terminal = ['DELIVERED', 'CANCELLED', 'RETURNED'].includes(shipment.status);
      if (terminal && !(shipment.status === 'DELIVERED' && status === 'RETURNED')) {
        throw new AppError('Shipment is already closed', 409);
      }
      if (['SHIPPED', 'IN_TRANSIT'].includes(status)) {
        throw new AppError('Harvest shipments wait for customer confirmation in PENDING', 409);
      }
      if (status === 'PENDING') throw new AppError('Shipment cannot be reset to pending', 409);
    }
    const result = await setStatus(client, shipmentId, status, actor);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function confirmReceived(shipmentId, actor) {
  if (Number(actor?.role_id) !== 3) throw new AppError('Customer role required', 403);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lookup = await client.query(
      `SELECT sh.harvest_request_id, sh.order_id FROM shipments sh JOIN orders o USING (order_id)
       WHERE sh.shipment_id = $1 AND o.user_id = $2`,
      [shipmentId, actor.user_id],
    );
    const linked = lookup.rows[0];
    if (!linked) throw new AppError('Shipment not found', 404);
    const request = await lockRequest(client, linked.harvest_request_id);
    if (!request || request.order_id !== linked.order_id || request.harvest_method !== 'DELIVERY') {
      throw new AppError('Shipment is not linked to a delivery harvest', 409);
    }
    const order = await client.query('SELECT user_id FROM orders WHERE order_id = $1 FOR UPDATE', [linked.order_id]);
    if (Number(order.rows[0]?.user_id) !== Number(actor.user_id)) throw new AppError('Shipment not found', 404);
    const current = await client.query('SELECT * FROM shipments WHERE shipment_id = $1 FOR UPDATE', [shipmentId]);
    const shipment = current.rows[0];
    if (!shipment) throw new AppError('Shipment not found', 404);
    if (shipment.status === 'DELIVERED' && request.status === 'COMPLETED') {
      await client.query('COMMIT');
      return shipment;
    }
    if (shipment.status !== 'PENDING') {
      throw new AppError('Only pending shipments can be confirmed', 409);
    }
    const harvest = await client.query(
      `SELECT 1 FROM harvests WHERE harvest_request_id = $1 AND session_id = $2 AND status = 'COMPLETED'`,
      [request.harvest_request_id, request.session_id],
    );
    if (!harvest.rows.length) throw new AppError('Harvest must be completed before confirmation', 409);
    const result = await setStatus(client, shipmentId, 'DELIVERED', actor);
    await completeHandover(client, request, actor.user_id);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function updateDetails(shipmentId, details) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const currentResult = await client.query(
      `SELECT status, shipped_at, delivered_at
       FROM shipments
       WHERE shipment_id = $1::integer
       FOR UPDATE`,
      [shipmentId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AppError('Shipment not found', 404);

    const shippedAt = details.shippedAt;
    const deliveredAt = details.deliveredAt === undefined
      ? current.delivered_at
      : details.deliveredAt;
    if (
      ['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'RETURNED'].includes(current.status)
      && !shippedAt
    ) {
      throw new AppError('Handoff time is required for this shipment status', 400);
    }
    if (current.status === 'DELIVERED' && !deliveredAt) {
      throw new AppError('Delivery time is required for delivered shipments', 400);
    }
    if (
      shippedAt
      && deliveredAt
      && new Date(deliveredAt).getTime() < new Date(shippedAt).getTime()
    ) {
      throw new AppError('Delivery time cannot be earlier than handoff time', 400);
    }
    if (
      details.deliveredAt !== undefined
      && !['DELIVERED', 'RETURNED'].includes(current.status)
    ) {
      throw new AppError('Delivery time can only be updated after delivery', 409);
    }

    const result = await client.query(
      `UPDATE shipments
       SET carrier = $2,
           tracking_code = $3,
           shipping_fee = $4,
           shipped_at = $5,
           delivered_at = $6
       WHERE shipment_id = $1::integer
       RETURNING *`,
      [
        shipmentId,
        details.carrier,
        details.trackingCode,
        details.shippingFee,
        shippedAt,
        deliveredAt,
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

module.exports = {
  create,
  findAllForAdmin,
  findAllForOrder,
  updateStatus,
  updateDetails,
  createForHarvest,
  confirmReceived,
};
