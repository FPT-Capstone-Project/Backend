const pool = require('../config/db');
const AppError = require('../utils/app-error');

async function findAllByUserId(userId) {
  const result = await pool.query(
    `SELECT order_id, user_id, subtotal, discount, shipping_fee, total_amount,
            status, payment_status, created_at, updated_at
     FROM orders
     WHERE user_id = $1
     ORDER BY created_at DESC, order_id DESC`,
    [userId],
  );
  return result.rows;
}

async function findByIdForUser(orderId, userId) {
  const result = await pool.query(
    `SELECT o.order_id, o.user_id, o.subtotal, o.discount, o.shipping_fee,
          o.total_amount, o.status, o.payment_status, o.created_at, o.updated_at,
            oi.order_item_id, oi.item_type, oi.rental_package_id,
            oi.mushroom_type_id, oi.quantity, oi.unit_price, oi.total_price,
            rp.package_name, mt.name AS mushroom_name,
            cs.session_id, cs.status AS cultivation_status,
            cs.start_at AS cultivation_start_at, cs.harvest_date
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.order_id
     LEFT JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
     LEFT JOIN mushroom_types mt ON mt.mushroom_type_id = oi.mushroom_type_id
     LEFT JOIN LATERAL (
       SELECT session_id, status, start_at, harvest_date
       FROM cultivation_sessions
       WHERE order_item_id = oi.order_item_id
       ORDER BY session_id DESC
       LIMIT 1
     ) cs ON TRUE
     WHERE o.order_id = $1 AND o.user_id = $2
     ORDER BY oi.order_item_id`,
    [orderId, userId],
  );

  if (result.rows.length === 0) return null;

  const firstRow = result.rows[0];
  return {
    order_id: firstRow.order_id,
    user_id: firstRow.user_id,
    subtotal: firstRow.subtotal,
    discount: firstRow.discount,
    shipping_fee: firstRow.shipping_fee,
    total_amount: firstRow.total_amount,
    status: firstRow.status,
    payment_status: firstRow.payment_status,
    created_at: firstRow.created_at,
    updated_at: firstRow.updated_at,
    items: result.rows
      .filter((row) => row.order_item_id !== null)
      .map((row) => ({
        order_item_id: row.order_item_id,
        item_type: row.item_type,
        rental_package_id: row.rental_package_id,
        mushroom_type_id: row.mushroom_type_id,
        package_name: row.package_name,
        mushroom_name: row.mushroom_name,
        session_id: row.session_id,
        cultivation_status: row.cultivation_status,
        cultivation_start_at: row.cultivation_start_at,
        harvest_date: row.harvest_date,
        quantity: row.quantity,
        unit_price: row.unit_price,
        total_price: row.total_price,
      })),
  };
}

async function cancelOrderForUser(orderId, userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `SELECT order_id, status, payment_status
       FROM orders
       WHERE order_id = $1 AND user_id = $2
       FOR UPDATE`,
      [orderId, userId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new AppError('Order not found', 404);
    if (order.status !== 'PENDING') {
      throw new AppError('Only pending orders can be cancelled', 409);
    }
    if (!['UNPAID', 'PENDING', 'FAILED'].includes(order.payment_status)) {
      throw new AppError('Only unpaid orders or orders with failed payment can be cancelled', 409);
    }

    if (order.payment_status === 'PENDING') {
      await client.query(
        `UPDATE payments
         SET status = 'CANCELLED'
         WHERE order_id = $1 AND status = 'PENDING'`,
        [orderId],
      );
    }

    await client.query(
      `UPDATE tray_reservations
       SET status = 'RELEASED', released_at = CURRENT_TIMESTAMP
       WHERE status = 'HELD'
         AND order_item_id IN (
           SELECT order_item_id FROM order_items WHERE order_id = $1
         )`,
      [orderId],
    );

    const updateResult = await client.query(
      `UPDATE orders
       SET status = 'CANCELLED'${order.payment_status === 'PENDING' ? ", payment_status = 'FAILED'" : ''}
       WHERE order_id = $1 AND user_id = $2
       RETURNING order_id, user_id, subtotal, discount, shipping_fee,
                 total_amount, status, payment_status, created_at, updated_at`,
      [orderId, userId],
    );

    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function createCultivationOrder({ userId, packageId, mushroomTypeId, quantity }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const packageResult = await client.query(
      `SELECT package_id, package_name, duration_days, price, status
       FROM rental_packages
       WHERE package_id = $1
       FOR SHARE`,
      [packageId],
    );
    const rentalPackage = packageResult.rows[0];
    if (!rentalPackage) throw new AppError('Cultivation package not found', 404);
    if (rentalPackage.status !== 'ACTIVE') {
      throw new AppError('Cultivation package is not available', 400);
    }

    const mushroomResult = await client.query(
      `SELECT mushroom_type_id, name, growing_days, price, status
       FROM mushroom_types
       WHERE mushroom_type_id = $1
       FOR SHARE`,
      [mushroomTypeId],
    );
    const mushroomType = mushroomResult.rows[0];
    if (!mushroomType) throw new AppError('Mushroom type not found', 404);
    if (mushroomType.status !== 'ACTIVE') throw new AppError('Mushroom type is not available', 400);
    if (Number(mushroomType.growing_days) > Number(rentalPackage.duration_days)) {
      throw new AppError(
        `Growing this mushroom takes ${mushroomType.growing_days} days, longer than the ${rentalPackage.duration_days}-day package. Choose another mushroom type or package.`,
        400,
      );
    }

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
       WHERE status = 'HELD' AND expires_at > CURRENT_TIMESTAMP`,
    );
    const availableQuantity = availableTraysResult.rows.length
      - Number(heldTraysResult.rows[0]?.quantity || 0);
    if (availableQuantity < quantity) {
      throw new AppError(
        `Only ${Math.max(availableQuantity, 0)} cultivation trays are currently available`,
        409,
      );
    }

    const packagePrice = rentalPackage.price;
    const orderResult = await client.query(
      `INSERT INTO orders (user_id, subtotal, total_amount)
       VALUES (
         $1,
         ($2::numeric + $3::numeric) * $4::integer,
         ($2::numeric + $3::numeric) * $4::integer
       )
       RETURNING order_id, user_id, subtotal, discount, shipping_fee,
             total_amount, status, payment_status, created_at, updated_at`,
      [userId, packagePrice, mushroomType.price, quantity],
    );
    const order = orderResult.rows[0];

    const itemResult = await client.query(
      `INSERT INTO order_items (
         order_id, item_type, rental_package_id, mushroom_type_id,
         quantity, unit_price, total_price
       )
       VALUES (
         $1, 'CULTIVATION', $2, $3, $4,
         $5::numeric + $6::numeric,
         ($5::numeric + $6::numeric) * $4::integer
       )
       RETURNING order_item_id, order_id, item_type, rental_package_id,
                 mushroom_type_id, quantity, unit_price, total_price`,
      [
        order.order_id,
        packageId,
        mushroomTypeId,
        quantity,
        packagePrice,
        mushroomType.price,
      ],
    );

    await client.query(
      `INSERT INTO tray_reservations (order_item_id, quantity, expires_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
      [itemResult.rows[0].order_item_id, quantity],
    );

    await client.query('COMMIT');
    return {
      ...order,
      items: [{
        ...itemResult.rows[0],
        package_name: rentalPackage.package_name,
        mushroom_name: mushroomType.name,
      }],
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  findAllByUserId,
  findByIdForUser,
  cancelOrderForUser,
  createCultivationOrder,
};
