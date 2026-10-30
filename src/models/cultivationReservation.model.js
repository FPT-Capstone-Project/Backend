const AppError = require('../utils/app-error');

const SPAWN_UNITS_PER_TRAY = 3;

function toHoldMinutes(value) {
  const minutes = Number(value);
  const wholeMinutes = Math.floor(minutes);
  return Number.isFinite(wholeMinutes) && wholeMinutes > 0 ? wholeMinutes : 15;
}

function requiredSpawnForTrays(trayQuantity) {
  const quantity = Number(trayQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new AppError('Tray quantity must be a positive integer', 400);
  }
  const requiredSpawn = quantity * SPAWN_UNITS_PER_TRAY;
  if (!Number.isSafeInteger(requiredSpawn) || requiredSpawn > 2147483647) {
    throw new AppError('Tray quantity is too large', 400);
  }
  return requiredSpawn;
}

function insufficientTraysError(availableQuantity) {
  const available = Number(availableQuantity);
  const message = Number.isFinite(available)
    ? `Only ${Math.max(available, 0)} cultivation trays are currently available`
    : 'Insufficient cultivation trays';
  return new AppError(message, 409, 'INSUFFICIENT_TRAYS');
}

function insufficientSpawnError(availableQuantity) {
  const available = Number(availableQuantity);
  const message = Number.isFinite(available)
    ? `Only ${Math.max(available, 0)} spawn units are currently available`
    : 'Insufficient mushroom spawn';
  return new AppError(message, 409, 'INSUFFICIENT_SPAWN');
}

async function lockCultivationCapacity(client, {
  orderItemId,
  mushroomTypeId,
  trayQuantity,
  spawnQuantity = requiredSpawnForTrays(trayQuantity),
}) {
  // Locks every allocatable tray so concurrent holds cannot both count the same capacity.
  const traysResult = await client.query(
    `SELECT t.tray_id
     FROM cultivation_trays t
     INNER JOIN cultivation_floors f ON f.floor_id = t.floor_id
     WHERE t.status = 'AVAILABLE' AND f.status = 'ACTIVE'
     ORDER BY t.tray_id
     FOR UPDATE OF t`,
  );
  const heldTraysResult = await client.query(
    `SELECT COALESCE(SUM(tr.quantity), 0)::int AS quantity
     FROM tray_reservations tr
     INNER JOIN order_items oi ON oi.order_item_id = tr.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE tr.status = 'HELD'
       AND tr.expires_at > CURRENT_TIMESTAMP
       AND tr.order_item_id <> $1
       AND o.status = 'PENDING'
       AND o.payment_status IN ('UNPAID', 'PENDING', 'FAILED')`,
    [orderItemId],
  );
  const availableTrayQuantity = traysResult.rows.length
    - Number(heldTraysResult.rows[0]?.quantity || 0);

  const heldSpawnResult = await client.query(
    `SELECT COALESCE(SUM(tr.spawn_quantity), 0)::numeric AS quantity
     FROM tray_reservations tr
     INNER JOIN order_items oi ON oi.order_item_id = tr.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE tr.status = 'HELD'
       AND tr.expires_at > CURRENT_TIMESTAMP
       AND oi.mushroom_type_id = $1
       AND tr.order_item_id <> $2
       AND o.status = 'PENDING'
       AND o.payment_status IN ('UNPAID', 'PENDING', 'FAILED')`,
    [mushroomTypeId, orderItemId],
  );
  const inventoryResult = await client.query(
    `SELECT inventory_id, mushroom_type_id, quantity
     FROM spawn_inventory
     WHERE mushroom_type_id = $1
     FOR UPDATE`,
    [mushroomTypeId],
  );
  const inventory = inventoryResult.rows[0] || null;
  const availableSpawnQuantity = inventory
    ? Number(inventory.quantity) - Number(heldSpawnResult.rows[0]?.quantity || 0)
    : 0;

  return {
    trays: traysResult.rows,
    inventory,
    availableTrayQuantity,
    availableSpawnQuantity,
    hasEnoughTrays: availableTrayQuantity >= Number(trayQuantity),
    hasEnoughSpawn: availableSpawnQuantity >= Number(spawnQuantity),
  };
}

async function assertCultivationCapacity(client, reservation) {
  const capacity = await lockCultivationCapacity(client, reservation);
  if (!capacity.hasEnoughTrays) throw insufficientTraysError(capacity.availableTrayQuantity);
  if (!capacity.hasEnoughSpawn) throw insufficientSpawnError(capacity.availableSpawnQuantity);
  return capacity;
}

async function renewReservation(client, {
  orderItemId,
  trayQuantity,
  spawnQuantity = requiredSpawnForTrays(trayQuantity),
  holdMinutes,
}) {
  const minutes = toHoldMinutes(holdMinutes);
  const updatedResult = await client.query(
    `UPDATE tray_reservations
     SET quantity = $2,
         spawn_quantity = $3,
         status = 'HELD',
         expires_at = CURRENT_TIMESTAMP + ($4 * INTERVAL '1 minute'),
         released_at = NULL
     WHERE reservation_id = (
       SELECT reservation_id
       FROM tray_reservations
       WHERE order_item_id = $1
       ORDER BY reservation_id DESC
       LIMIT 1
       FOR UPDATE
     )
     RETURNING reservation_id, order_item_id, quantity, spawn_quantity, status, expires_at`,
    [orderItemId, trayQuantity, spawnQuantity, minutes],
  );
  if (updatedResult.rows[0]) return updatedResult.rows[0];

  const insertedResult = await client.query(
    `INSERT INTO tray_reservations (
       order_item_id, quantity, spawn_quantity, status, expires_at
     )
     VALUES ($1, $2, $3, 'HELD', CURRENT_TIMESTAMP + ($4 * INTERVAL '1 minute'))
     RETURNING reservation_id, order_item_id, quantity, spawn_quantity, status, expires_at`,
    [orderItemId, trayQuantity, spawnQuantity, minutes],
  );
  return insertedResult.rows[0];
}

async function findLatestReservationForUpdate(client, orderItemId) {
  const result = await client.query(
    `SELECT reservation_id, order_item_id, quantity, spawn_quantity, status, expires_at,
            expires_at > CURRENT_TIMESTAMP AS is_active
     FROM tray_reservations
     WHERE order_item_id = $1
     ORDER BY reservation_id DESC
     LIMIT 1
     FOR UPDATE`,
    [orderItemId],
  );
  return result.rows[0] || null;
}

function isActiveReservation(reservation) {
  if (!reservation || reservation.status !== 'HELD') return false;
  if (typeof reservation.is_active === 'boolean') return reservation.is_active;
  const expiresAt = new Date(reservation.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

module.exports = {
  SPAWN_UNITS_PER_TRAY,
  requiredSpawnForTrays,
  insufficientTraysError,
  insufficientSpawnError,
  lockCultivationCapacity,
  assertCultivationCapacity,
  renewReservation,
  findLatestReservationForUpdate,
  isActiveReservation,
  toHoldMinutes,
};
