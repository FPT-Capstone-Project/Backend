const pool = require('../config/db');

const roomColumns = `
  room_id,
  room_code,
  room_name,
  description,
  capacity,
  status,
  created_at,
  updated_at
`;

async function findAll({ status } = {}) {
  const params = [];
  let query = `SELECT ${roomColumns} FROM cultivation_rooms`;
  if (status) {
    params.push(status);
    query += ' WHERE status = $1';
  }
  query += ' ORDER BY created_at DESC';
  const result = await pool.query(query, params);
  return result.rows;
}

async function findById(roomId) {
  const result = await pool.query(
    `SELECT ${roomColumns} FROM cultivation_rooms WHERE room_id = $1 LIMIT 1`,
    [roomId],
  );
  return result.rows[0] || null;
}

async function create({ roomCode, roomName, description, capacity, status }) {
  const result = await pool.query(
    `INSERT INTO cultivation_rooms (room_code, room_name, description, capacity, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${roomColumns}`,
    [roomCode, roomName, description, capacity, status],
  );
  return result.rows[0];
}

async function updateById(roomId, data = {}) {
  const values = [];
  const fields = [];
  Object.entries(data).forEach(([key, value]) => {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  });
  if (fields.length === 0) return findById(roomId);

  values.push(roomId);
  const result = await pool.query(
    `UPDATE cultivation_rooms SET ${fields.join(', ')}
     WHERE room_id = $${values.length}
     RETURNING ${roomColumns}`,
    values,
  );
  return result.rows[0] || null;
}

async function removeById(roomId) {
  const result = await pool.query(
    `DELETE FROM cultivation_rooms WHERE room_id = $1 RETURNING ${roomColumns}`,
    [roomId],
  );
  return result.rows[0] || null;
}

module.exports = { findAll, findById, create, updateById, removeById };