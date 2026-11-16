const pool = require('../config/db');
const AppError = require('../utils/app-error');

async function completeSanitation(trayId, userId, db = pool) {
  const client = db.connect ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const tray = (await client.query('SELECT * FROM cultivation_trays WHERE tray_id=$1 FOR UPDATE', [trayId])).rows[0];
    if (!tray) throw new AppError('Không tìm thấy khay', 404);
    if (tray.status !== 'MAINTENANCE') throw new AppError('Khay không còn ở trạng thái bảo trì / vệ sinh. Hãy tải lại danh sách.', 409);
    const active = await client.query("SELECT 1 FROM cultivation_session_trays WHERE tray_id=$1 AND status='ACTIVE' LIMIT 1", [trayId]);
    if (active.rows.length) throw new AppError('Không thể hoàn tất vệ sinh khi khay còn phiên trồng hoạt động', 409);
    const result = await client.query(`UPDATE cultivation_trays SET status='AVAILABLE',
      last_cleaned_at=CURRENT_TIMESTAMP,last_cleaned_by=$2,updated_at=CURRENT_TIMESTAMP
      WHERE tray_id=$1 RETURNING *`, [trayId, userId]);
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { if (db.connect) client.release(); }
}

const trayColumns = `
  t.tray_id,
  t.room_id,
  r.room_code,
  r.room_name,
  t.floor_id,
  t.position_id,
  p.row_number,
  p.column_number,
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
    LEFT JOIN cultivation_floors f ON f.floor_id = t.floor_id
    LEFT JOIN tray_positions p ON p.position_id = t.position_id`;
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
     LEFT JOIN tray_positions p ON p.position_id = t.position_id
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

module.exports = { findAll, findById, findFloorById, create, updateById, removeById, completeSanitation };
