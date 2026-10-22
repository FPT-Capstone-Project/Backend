const pool = require('../config/db');

const cameraColumns = `
  c.camera_id,
  c.room_id,
  cr.room_code,
  cr.room_name,
  c.camera_code,
  c.camera_name,
  c.stream_url,
  c.status
`;

async function findAll({ cameraId, roomId, status } = {}) {
  const conditions = [];
  const values = [];
  if (cameraId !== undefined) {
    values.push(cameraId);
    conditions.push(`c.camera_id = $${values.length}`);
  }
  if (roomId !== undefined) {
    values.push(roomId);
    conditions.push(`c.room_id = $${values.length}`);
  }
  if (status !== undefined) {
    values.push(status);
    conditions.push(`c.status = $${values.length}`);
  }
  const result = await pool.query(
    `SELECT ${cameraColumns}
     FROM cameras c
     INNER JOIN cultivation_rooms cr ON cr.room_id = c.room_id
     ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
     ORDER BY c.camera_id`,
    values,
  );
  return result.rows;
}

async function findById(cameraId) {
  const result = await pool.query(
    `SELECT ${cameraColumns}
     FROM cameras c
     INNER JOIN cultivation_rooms cr ON cr.room_id = c.room_id
     WHERE c.camera_id = $1
     LIMIT 1`,
    [cameraId],
  );
  return result.rows[0] || null;
}

async function create({ roomId, cameraCode, cameraName, streamUrl, status }) {
  const result = await pool.query(
    `INSERT INTO cameras (room_id, camera_code, camera_name, stream_url, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING camera_id, room_id, camera_code, camera_name, stream_url, status`,
    [roomId, cameraCode, cameraName, streamUrl, status],
  );
  return result.rows[0];
}

async function updateById(cameraId, data) {
  const values = [];
  const fields = [];
  Object.entries(data).forEach(([key, value]) => {
    values.push(value);
    fields.push(`${key} = $${values.length}`);
  });
  values.push(cameraId);
  const result = await pool.query(
    `UPDATE cameras
     SET ${fields.join(', ')}
     WHERE camera_id = $${values.length}
     RETURNING camera_id, room_id, camera_code, camera_name, stream_url, status`,
    values,
  );
  return result.rows[0] || null;
}

async function removeById(cameraId) {
  const result = await pool.query(
    `DELETE FROM cameras
     WHERE camera_id = $1
     RETURNING camera_id, room_id, camera_code, camera_name, stream_url, status`,
    [cameraId],
  );
  return result.rows[0] || null;
}

module.exports = { findAll, findById, create, updateById, removeById };
