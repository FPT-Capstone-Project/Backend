const pool = require('../config/db');

const trayColumns = `
  t.tray_id,
  t.room_id,
  r.room_code,
  r.room_name,
  t.floor_id,
  f.floor_number,
  f.floor_name,
  t.tray_code,
  t.tray_name,
  t.status,
  t.created_at,
  t.updated_at
`;

async function findAll({ roomId, floorId, status } = {}) {
  const conditions = [];
  const params = [];
  if (roomId !== undefined && roomId !== null) {
    params.push(roomId);
    conditions.push(`t.room_id = $${params.length}`);
  }
  if (floorId !== undefined && floorId !== null) {
    params.push(floorId);
    conditions.push(`t.floor_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`t.status = $${params.length}`);
  }
  let query = `SELECT ${trayColumns}
    FROM cultivation_trays t
    INNER JOIN cultivation_rooms r ON r.room_id = t.room_id
    LEFT JOIN cultivation_floors f ON f.floor_id = t.floor_id`;
  if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' ORDER BY t.created_at DESC';
  const result = await pool.query(query, params);
  return result.rows;
}

async function findById(trayId) {
  const result = await pool.query(
    `SELECT ${trayColumns}
     FROM cultivation_trays t
     INNER JOIN cultivation_rooms r ON r.room_id = t.room_id
     LEFT JOIN cultivation_floors f ON f.floor_id = t.floor_id
     WHERE t.tray_id = $1
     LIMIT 1`,
    [trayId],
  );
  return result.rows[0] || null;
}

async function findFloorById(floorId) {
  const result = await pool.query(
    `SELECT floor_id, room_id, floor_number, floor_name, status
     FROM cultivation_floors
     WHERE floor_id = $1
     LIMIT 1`,
    [floorId],
  );
  return result.rows[0] || null;
}

async function create({ roomId, floorId, trayCode, trayName, status }) {
  const result = await pool.query(
    `INSERT INTO cultivation_trays (room_id, floor_id, tray_code, tray_name, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING tray_id`,
    [roomId, floorId, trayCode, trayName, status],
  );
  return findById(result.rows[0].tray_id);
}

async function updateById(trayId, data = {}) {
  const values = [];
  const fields = [];
  Object.entries(data).forEach(([key, value]) => {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  });
  if (fields.length === 0) return findById(trayId);

  values.push(trayId);
  const result = await pool.query(
    `UPDATE cultivation_trays SET ${fields.join(', ')}
     WHERE tray_id = $${values.length}
     RETURNING tray_id`,
    values,
  );
  if (!result.rows[0]) return null;
  return findById(result.rows[0].tray_id);
}

async function removeById(trayId) {
  const result = await pool.query(
    `DELETE FROM cultivation_trays WHERE tray_id = $1 RETURNING tray_id, room_id, floor_id,
       tray_code, tray_name, status, created_at, updated_at`,
    [trayId],
  );
  return result.rows[0] || null;
}

module.exports = { findAll, findById, findFloorById, create, updateById, removeById };