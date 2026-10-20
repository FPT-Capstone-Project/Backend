const pool = require('../config/db');
const AppError = require('../utils/app-error');

const rentalJoins = `
  FROM rentals r
  INNER JOIN users u ON u.user_id = r.user_id
  INNER JOIN orders o ON o.order_id = r.order_id
  LEFT JOIN LATERAL (
    SELECT rp.package_id, rp.package_name
    FROM order_items oi
    INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
    WHERE oi.order_id = r.order_id AND oi.item_type = 'RENTAL'
    ORDER BY oi.order_item_id
    LIMIT 1
  ) rp ON TRUE
  LEFT JOIN LATERAL (
    SELECT mt.mushroom_type_id, mt.name AS mushroom_name
    FROM order_items oi
    INNER JOIN mushroom_types mt ON mt.mushroom_type_id = oi.mushroom_type_id
    WHERE oi.order_id = r.order_id
    ORDER BY oi.order_item_id
    LIMIT 1
  ) mushroom ON TRUE
  LEFT JOIN cultivation_trays ct ON ct.tray_id = r.tray_id
  LEFT JOIN cultivation_rooms cr ON cr.room_id = ct.room_id
  LEFT JOIN cultivation_floors cf ON cf.floor_id = ct.floor_id
`;

const rentalFields = `
  r.rental_id, r.order_id, r.user_id, u.full_name AS customer_name,
  u.email AS customer_email, u.phone AS customer_phone,
  rp.package_id, rp.package_name, mushroom.mushroom_type_id, mushroom.mushroom_name,
  r.duration_days, r.tray_id,
  ct.tray_code, ct.tray_name, cr.room_id, cr.room_code, cr.room_name,
  cf.floor_id, cf.floor_number, cf.floor_name,
  r.start_date, r.end_date, r.status, o.payment_status,
  r.created_at, r.updated_at
`;

function buildFilters(filters = {}) {
  const conditions = [];
  const values = [];
  const addFilter = (column, value) => {
    if (value === undefined || value === null) return;
    values.push(value);
    conditions.push(`${column} = $${values.length}`);
  };

  addFilter('r.status', filters.status);
  addFilter('r.user_id', filters.userId);
  addFilter('rp.package_id', filters.packageId);
  addFilter('r.tray_id', filters.trayId);

  if (filters.startDateFrom) {
    values.push(filters.startDateFrom);
    conditions.push(`r.start_date >= $${values.length}::timestamp`);
  }
  if (filters.startDateTo) {
    values.push(filters.startDateTo);
    conditions.push(`r.start_date <= $${values.length}::timestamp`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values };
}

async function findAllForAdmin(filters = {}) {
  const { where, values } = buildFilters(filters);
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total
     ${rentalJoins}
     ${where}`,
    values,
  );
  const pageValues = [...values, filters.limit, filters.offset];
  const result = await pool.query(
    `SELECT ${rentalFields}
     ${rentalJoins}
     ${where}
     ORDER BY r.created_at DESC, r.rental_id DESC
     LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`,
    pageValues,
  );
  return {
    rentals: result.rows,
    total: Number(countResult.rows[0] && countResult.rows[0].total) || 0,
  };
}

async function findByIdForAdmin(rentalId) {
  const result = await pool.query(
    `SELECT ${rentalFields}
     ${rentalJoins}
     WHERE r.rental_id = $1
     LIMIT 1`,
    [rentalId],
  );
  return result.rows[0] || null;
}

async function createFromOrderForAdmin(orderId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const orderResult = await client.query(
      `SELECT o.order_id, o.user_id, o.status, o.payment_status,
              rp.duration_days
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.order_id AND oi.item_type = 'RENTAL'
       INNER JOIN rental_packages rp ON rp.package_id = oi.rental_package_id
       WHERE o.order_id = $1
       ORDER BY oi.order_item_id
       LIMIT 1
       FOR UPDATE OF o`,
      [orderId],
    );
    const order = orderResult.rows[0];
    if (!order) throw new AppError('Paid rental order not found', 404);
    if (order.payment_status !== 'PAID') {
      throw new AppError('Only paid orders can be turned into rentals', 409);
    }
    if (order.status === 'CANCELLED') {
      throw new AppError('Cancelled orders cannot be turned into rentals', 409);
    }

    const insertedResult = await client.query(
      `INSERT INTO rentals (order_id, user_id, duration_days)
       VALUES ($1, $2, $3)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING rental_id`,
      [order.order_id, order.user_id, order.duration_days],
    );
    const rentalId = insertedResult.rows[0] && insertedResult.rows[0].rental_id;
    if (rentalId) {
      await client.query('COMMIT');
      return { rentalId, created: true };
    }

    const existingResult = await client.query(
      'SELECT rental_id FROM rentals WHERE order_id = $1 LIMIT 1',
      [orderId],
    );
    if (!existingResult.rows[0]) {
      throw new AppError('Unable to create rental from order', 500);
    }

    await client.query('COMMIT');
    return { rentalId: existingResult.rows[0].rental_id, created: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function startCultivationForAdmin(rentalId, trayId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const rentalResult = await client.query(
      `SELECT r.rental_id, r.order_id, r.user_id, r.status, r.duration_days,
              o.status AS order_status, o.payment_status
       FROM rentals r
       INNER JOIN orders o ON o.order_id = r.order_id
       WHERE r.rental_id = $1
       FOR UPDATE OF r, o`,
      [rentalId],
    );
    const rental = rentalResult.rows[0];
    if (!rental) throw new AppError('Rental not found', 404);
    if (rental.payment_status !== 'PAID') {
      throw new AppError('Only paid rentals can start cultivation', 409);
    }
    if (rental.order_status === 'CANCELLED') {
      throw new AppError('Cancelled orders cannot start cultivation', 409);
    }
    if (!['CONFIRMED', 'PREPARING'].includes(rental.status)) {
      throw new AppError('Only confirmed or preparing rentals can start cultivation', 409);
    }

    const trayResult = await client.query(
      `SELECT t.tray_id, t.status, t.floor_id
       FROM cultivation_trays t
       WHERE t.tray_id = $1
       FOR UPDATE OF t`,
      [trayId],
    );
    const tray = trayResult.rows[0];
    if (!tray) throw new AppError('Cultivation tray not found', 404);
    if (tray.status !== 'AVAILABLE') {
      throw new AppError('Cultivation tray is unavailable', 409);
    }
    if (tray.floor_id == null) {
      throw new AppError('Assign the cultivation tray to a floor before starting cultivation', 409);
    }

    const floorResult = await client.query(
      `SELECT floor_id, status
       FROM cultivation_floors
       WHERE floor_id = $1
       FOR SHARE`,
      [tray.floor_id],
    );
    const floor = floorResult.rows[0];
    if (!floor) throw new AppError('Cultivation tray floor not found', 409);
    if (floor.status !== 'ACTIVE') {
      throw new AppError('Cultivation tray floor is not active', 409);
    }

    const orderItemResult = await client.query(
      `SELECT oi.order_item_id, oi.mushroom_type_id
       FROM order_items oi
       WHERE oi.order_id = $1
         AND (
           (oi.item_type = 'RENTAL' AND oi.rental_package_id IS NOT NULL)
           OR oi.item_type = 'MUSHROOM'
         )
       ORDER BY CASE
         WHEN oi.item_type = 'RENTAL' AND oi.mushroom_type_id IS NOT NULL THEN 0
         WHEN oi.item_type = 'MUSHROOM' THEN 1
         ELSE 2
       END, oi.order_item_id
       LIMIT 1`,
      [rental.order_id],
    );
    const orderItem = orderItemResult.rows[0];
    if (!orderItem || orderItem.mushroom_type_id == null) {
      throw new AppError('No mushroom type is associated with this rental order', 409);
    }

    const mushroomResult = await client.query(
      `SELECT mushroom_type_id, name, growing_days, status
       FROM mushroom_types
       WHERE mushroom_type_id = $1`,
      [orderItem.mushroom_type_id],
    );
    const mushroom = mushroomResult.rows[0];
    if (!mushroom) {
      throw new AppError('The ordered mushroom type was not found', 409);
    }
    if (mushroom.status !== 'ACTIVE') {
      throw new AppError('The ordered mushroom type is not active', 409);
    }
    if (Number(mushroom.growing_days) > Number(rental.duration_days)) {
      throw new AppError('Mushroom growing time exceeds the rental duration', 409);
    }

    const existingSession = await client.query(
      `SELECT session_id
       FROM cultivation_sessions
       WHERE rental_id = $1
          OR (tray_id = $2 AND status IN ('PLANNED', 'ACTIVE'))
       FOR UPDATE`,
      [rentalId, trayId],
    );
    if (existingSession.rows.length > 0) {
      throw new AppError('Rental or tray already has a cultivation session', 409);
    }

    const sessionResult = await client.query(
      `INSERT INTO cultivation_sessions (
         rental_id, tray_id, mushroom_type_id, start_at, duration_days, status, harvest_date
       )
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4::integer, 'ACTIVE', CURRENT_DATE + $4::integer)
       RETURNING *`,
      [rentalId, trayId, mushroom.mushroom_type_id, mushroom.growing_days],
    );

    await client.query(
      `UPDATE rentals
       SET tray_id = $2,
           status = 'ACTIVE',
           start_date = CURRENT_TIMESTAMP,
           end_date = CURRENT_TIMESTAMP + duration_days * INTERVAL '1 day',
           updated_at = CURRENT_TIMESTAMP
       WHERE rental_id = $1`,
      [rentalId, trayId],
    );
    await client.query(
      `UPDATE cultivation_trays
       SET status = 'OCCUPIED', updated_at = CURRENT_TIMESTAMP
       WHERE tray_id = $1`,
      [trayId],
    );

    await client.query('COMMIT');
    return {
      session: sessionResult.rows[0],
      rental: await findByIdForAdmin(rentalId),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function dateMilliseconds(value) {
  if (value == null) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

async function updateForAdmin(rentalId, changes) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const rentalResult = await client.query(
      `SELECT r.rental_id, r.order_id, r.status, r.tray_id, r.duration_days,
              r.start_date, r.end_date, o.payment_status
       FROM rentals r
       INNER JOIN orders o ON o.order_id = r.order_id
       WHERE r.rental_id = $1
       FOR UPDATE OF r`,
      [rentalId],
    );
    const rental = rentalResult.rows[0];
    if (!rental) throw new AppError('Rental not found', 404);

    const status = changes.status === undefined ? rental.status : changes.status;
    const trayId = changes.trayId === undefined ? rental.tray_id : changes.trayId;
    const durationDays = changes.durationDays === undefined
      ? rental.duration_days
      : changes.durationDays;
    const startDate = changes.startDate === undefined ? rental.start_date : changes.startDate;
    const endDate = changes.endDate === undefined ? rental.end_date : changes.endDate;

    const startTime = dateMilliseconds(startDate);
    const endTime = dateMilliseconds(endDate);
    if (startDate != null && startTime === null) {
      throw new AppError('startDate must be a valid timestamp', 400);
    }
    if (endDate != null && endTime === null) {
      throw new AppError('endDate must be a valid timestamp', 400);
    }
    if (startTime !== null && endTime !== null && endTime <= startTime) {
      throw new AppError('endDate must be after startDate', 400);
    }

    const editableStatuses = ['CONFIRMED', 'PREPARING', 'ACTIVE'];
    const changesRentalDetails = changes.trayId !== undefined
      || changes.durationDays !== undefined
      || changes.startDate !== undefined
      || changes.endDate !== undefined;
    if (changesRentalDetails && !editableStatuses.includes(rental.status)) {
      throw new AppError('Only confirmed, preparing, or active rentals can be edited', 409);
    }

    if (changes.status !== undefined) {
      const transitions = {
        CONFIRMED: ['PREPARING', 'CANCELLED'],
        PREPARING: ['ACTIVE', 'CANCELLED'],
        ACTIVE: ['COMPLETED', 'CANCELLED'],
      };
      if (!transitions[rental.status] || !transitions[rental.status].includes(status)) {
        throw new AppError('Rental status transition is not allowed', 409);
      }
      if (status === 'ACTIVE' && rental.payment_status !== 'PAID') {
        throw new AppError('Only rentals with paid orders can be activated', 409);
      }
    }

    if (status === 'ACTIVE' && trayId == null) {
      throw new AppError('An active rental must be assigned to a cultivation tray', 400);
    }

    if (trayId != null && (changes.trayId !== undefined || status === 'ACTIVE')) {
      const trayResult = await client.query(
        `SELECT tray_id, status
         FROM cultivation_trays
         WHERE tray_id = $1
         FOR UPDATE`,
        [trayId],
      );
      if (!trayResult.rows[0]) throw new AppError('Cultivation tray not found', 404);

      const currentActiveTray = rental.status === 'ACTIVE'
        && rental.tray_id === trayId
        && trayResult.rows[0].status === 'OCCUPIED';
      if (status === 'ACTIVE' && trayResult.rows[0].status !== 'AVAILABLE' && !currentActiveTray) {
        throw new AppError('Cultivation tray is unavailable', 409);
      }
      if (status !== 'ACTIVE'
        && changes.trayId !== undefined
        && trayResult.rows[0].status !== 'AVAILABLE') {
        throw new AppError('Cultivation tray is unavailable', 409);
      }

      if (status === 'ACTIVE') {
        const conflictResult = await client.query(
          `SELECT rental_id
           FROM rentals
           WHERE tray_id = $1
             AND rental_id <> $2
             AND status = 'ACTIVE'
             AND (start_date IS NULL OR $4::timestamp IS NULL OR start_date <= $4::timestamp)
             AND (end_date IS NULL OR $3::timestamp IS NULL OR end_date >= $3::timestamp)
           LIMIT 1`,
          [trayId, rentalId, startDate, endDate],
        );
        if (conflictResult.rows[0]) {
          throw new AppError('Cultivation tray is already assigned to an overlapping active rental', 409);
        }
      }
    }

    if (rental.status === 'ACTIVE' && rental.tray_id !== trayId) {
      await client.query(
        `UPDATE cultivation_trays
         SET status = 'AVAILABLE', updated_at = NOW()
         WHERE tray_id = $1 AND status = 'OCCUPIED'`,
        [rental.tray_id],
      );
    }
    if (status === 'ACTIVE') {
      await client.query(
        `UPDATE cultivation_trays
         SET status = 'OCCUPIED', updated_at = NOW()
         WHERE tray_id = $1`,
        [trayId],
      );
    } else if (rental.status === 'ACTIVE') {
      await client.query(
        `UPDATE cultivation_trays
         SET status = 'AVAILABLE', updated_at = NOW()
         WHERE tray_id = $1 AND status = 'OCCUPIED'`,
        [rental.tray_id],
      );
    }

    await client.query(
      `UPDATE rentals
       SET status = $2,
           tray_id = $3,
           duration_days = $4,
           start_date = $5,
           end_date = $6,
           updated_at = CURRENT_TIMESTAMP
       WHERE rental_id = $1`,
      [rentalId, status, trayId, durationDays, startDate, endDate],
    );
    await client.query('COMMIT');
    return await findByIdForAdmin(rentalId);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  findAllForAdmin,
  findByIdForAdmin,
  createFromOrderForAdmin,
  startCultivationForAdmin,
  updateForAdmin,
};
