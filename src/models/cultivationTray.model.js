const pool = require('../config/db');

const trayColumns = `
  tray_id,
  room_id,
  tray_code,
  tray_name,
  status,
  created_at,
  updated_at
`;

async function findAll({ roomId, status } = {}) {
  const conditions = [];
  const params = [];
  if (roomId !== undefined && roomId !== null) {
    params.push(roomId);
    conditions.push(`room_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  let query = `SELECT ${trayColumns} FROM cultivation_trays`;
  if (conditions.length > 0) query += ` WHERE ${conditions.join(' AND ')}`;
  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);
  return result.rows;
}

async function findById(trayId) {
  const result = await pool.query(
    `SELECT ${trayColumns} FROM cultivation_trays WHERE tray_id = $1 LIMIT 1`,
    [trayId],
  );
  return result.rows[0] || null;
}

async function create({ roomId, trayCode, trayName, status }) {
  const result = await pool.query(
    `INSERT INTO cultivation_trays (room_id, tray_code, tray_name, status)
     VALUES ($1, $2, $3, $4)
     RETURNING ${trayColumns}`,
    [roomId, trayCode, trayName, status],
  );
  return result.rows[0];
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
     RETURNING ${trayColumns}`,
    values,
  );
  return result.rows[0] || null;
}

async function removeById(trayId) {
  const result = await pool.query(
    `DELETE FROM cultivation_trays WHERE tray_id = $1 RETURNING ${trayColumns}`,
    [trayId],
  );
  return result.rows[0] || null;
}

module.exports = { findAll, findById, create, updateById, removeById };