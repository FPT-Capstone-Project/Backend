const pool = require('../config/db');
const AppError = require('../utils/app-error');
const createQrToken = require('../utils/qr-token');

async function completeSanitationInTransaction(client, trayId, userId) {
  const tray = (await client.query(
    'SELECT * FROM cultivation_trays WHERE tray_id=$1 FOR UPDATE',
    [trayId],
  )).rows[0];
  if (!tray) throw new AppError('Không tìm thấy khay', 404);
  if (tray.status !== 'MAINTENANCE') {
    throw new AppError('Khay không còn ở trạng thái bảo trì / vệ sinh. Hãy tải lại danh sách.', 409);
  }
  const active = await client.query(
    "SELECT 1 FROM cultivation_session_trays WHERE tray_id=$1 AND status='ACTIVE' LIMIT 1",
    [trayId],
  );
  if (active.rows.length) {
    throw new AppError('Không thể hoàn tất vệ sinh khi khay còn phiên trồng hoạt động', 409);
  }
  const result = await client.query(`UPDATE cultivation_trays SET status='AVAILABLE',
    last_cleaned_at=CURRENT_TIMESTAMP,last_cleaned_by=$2,updated_at=CURRENT_TIMESTAMP
    WHERE tray_id=$1 RETURNING *`, [trayId, userId]);
  return result.rows[0];
}

async function completeSanitation(trayId, userId, db = pool) {
  const client = db.connect ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const tray = await completeSanitationInTransaction(client, trayId, userId);
    await client.query('COMMIT');
    return tray;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { if (db.connect) client.release(); }
}

async function completeSanitationByQr(qrToken, userId, db = pool) {
  const client = db.connect ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT tray_id FROM cultivation_trays WHERE qr_token=$1 FOR UPDATE',
      [qrToken],
    );
    if (!result.rows[0]) throw new AppError('Không tìm thấy khay theo QR code', 404);
    const tray = await completeSanitationInTransaction(client, result.rows[0].tray_id, userId);
    await client.query('COMMIT');
    return tray;
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

async function findById(trayId, db = pool) {
  const result = await db.query(
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

async function create({ roomId, floorId, trayCode, trayName, status, qrToken = createQrToken() }, db = pool) {
  const result = await db.query(
    `INSERT INTO cultivation_trays (room_id, floor_id, tray_code, tray_name, status, qr_token)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING tray_id`,
    [roomId, floorId, trayCode, trayName, status, qrToken],
  );
  return findById(result.rows[0].tray_id, db);
}

async function findQrTokenById(trayId, db = pool) {
  const result = await db.query(
    'SELECT qr_token FROM cultivation_trays WHERE tray_id = $1 LIMIT 1',
    [trayId],
  );
  return result.rows[0] || null;
}

async function generateMissingQrTokens(db = pool) {
  const client = db.connect ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const missing = await client.query(
      'SELECT tray_id FROM cultivation_trays WHERE qr_token IS NULL ORDER BY tray_id FOR UPDATE',
    );
    const trayIds = [];
    for (const { tray_id: trayId } of missing.rows) {
      const updated = await client.query(
        `UPDATE cultivation_trays
         SET qr_token = $2, updated_at = CURRENT_TIMESTAMP
         WHERE tray_id = $1 AND qr_token IS NULL
         RETURNING tray_id`,
        [trayId, createQrToken()],
      );
      if (updated.rows[0]) trayIds.push(updated.rows[0].tray_id);
    }
    await client.query('COMMIT');
    return trayIds;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (db.connect) client.release();
  }
}

async function findByQrToken(qrToken, db = pool) {
  const result = await db.query(
    'SELECT tray_id FROM cultivation_trays WHERE qr_token = $1 LIMIT 1',
    [qrToken],
  );
  if (!result.rows[0]) return null;

  const trayId = result.rows[0].tray_id;
  const [tray, sessions] = await Promise.all([
    findById(trayId, db),
    db.query(
      `SELECT s.session_id, st.session_tray_id, s.status, s.harvest_status,
              s.start_at, s.end_at, s.harvest_date, s.duration_days,
              s.mushroom_type_id, mt.name AS mushroom_name, st.assigned_at
       FROM cultivation_session_trays st
       INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
       LEFT JOIN mushroom_types mt ON mt.mushroom_type_id = s.mushroom_type_id
       WHERE st.tray_id = $1
         AND st.status = 'ACTIVE'
         AND s.status IN ('CULTIVATING', 'HARVEST_READY', 'HARVESTING')
       ORDER BY s.session_id`,
      [trayId],
    ),
  ]);
  return { tray, sessions: sessions.rows };
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

module.exports = {
  findAll,
  findById,
  findFloorById,
  create,
  findQrTokenById,
  generateMissingQrTokens,
  findByQrToken,
  updateById,
  removeById,
  completeSanitation,
  completeSanitationByQr,
};
