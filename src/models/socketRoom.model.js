const pool = require('../config/db');

async function findUserForSocket(userId) {
  const result = await pool.query(
    `SELECT u.user_id, u.role_id, u.status, r.role_name
     FROM users u
     INNER JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = $1
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

async function exists(query, values) {
  const result = await pool.query(query, values);
  return Boolean(result.rows[0]);
}

async function resourceExists(type, resourceId) {
  const queries = {
    room: 'SELECT 1 FROM cultivation_rooms WHERE room_id = $1 LIMIT 1',
    session: 'SELECT 1 FROM cultivation_sessions WHERE session_id = $1 LIMIT 1',
    issue: 'SELECT 1 FROM cultivation_issues WHERE issue_id = $1 LIMIT 1',
    consultation: 'SELECT 1 FROM expert_consultations WHERE consultation_id = $1 LIMIT 1',
  };
  return exists(queries[type], [resourceId]);
}

async function customerOwnsSession(sessionId, userId) {
  return exists(
    `SELECT 1
     FROM cultivation_sessions s
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE s.session_id = $1 AND o.user_id = $2
     LIMIT 1`,
    [sessionId, userId],
  );
}

async function customerHasActiveTrayInRoom(roomId, userId) {
  return exists(
    `SELECT 1
     FROM cultivation_rooms cr
     INNER JOIN cultivation_trays t ON t.room_id = cr.room_id
     INNER JOIN cultivation_session_trays st
       ON st.tray_id = t.tray_id AND st.status = 'ACTIVE'
     INNER JOIN cultivation_sessions s ON s.session_id = st.session_id
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE cr.room_id = $1 AND o.user_id = $2 AND o.payment_status = 'PAID'
       AND s.status IN ('CULTIVATING', 'HARVEST_READY', 'HARVESTING')
     LIMIT 1`,
    [roomId, userId],
  );
}

async function customerOwnsIssue(issueId, userId) {
  return exists(
    `SELECT 1
     FROM cultivation_issues ci
     LEFT JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN spawn_inspections spi ON spi.inspection_id = ci.spawn_inspection_id
     INNER JOIN cultivation_sessions s
       ON s.session_id = COALESCE(st.session_id, spi.session_id)
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE ci.issue_id = $1 AND o.user_id = $2
     LIMIT 1`,
    [issueId, userId],
  );
}

async function customerOwnsConsultation(consultationId, userId) {
  return exists(
    `SELECT 1
     FROM expert_consultations ec
     INNER JOIN cultivation_issues ci ON ci.issue_id = ec.issue_id
     LEFT JOIN cultivation_session_trays st ON st.session_tray_id = ci.session_tray_id
     LEFT JOIN spawn_inspections spi ON spi.inspection_id = ci.spawn_inspection_id
     INNER JOIN cultivation_sessions s
       ON s.session_id = COALESCE(st.session_id, spi.session_id)
     INNER JOIN order_items oi ON oi.order_item_id = s.order_item_id
     INNER JOIN orders o ON o.order_id = oi.order_id
     WHERE ec.consultation_id = $1 AND o.user_id = $2
     LIMIT 1`,
    [consultationId, userId],
  );
}

async function expertIsAssignedToIssue(issueId, userId) {
  return exists(
    `SELECT 1 FROM expert_consultations
     WHERE issue_id = $1 AND expert_id = $2
     LIMIT 1`,
    [issueId, userId],
  );
}

async function expertIsAssignedToConsultation(consultationId, userId) {
  return exists(
    `SELECT 1 FROM expert_consultations
     WHERE consultation_id = $1 AND expert_id = $2
     LIMIT 1`,
    [consultationId, userId],
  );
}

module.exports = {
  findUserForSocket,
  resourceExists,
  customerOwnsSession,
  customerHasActiveTrayInRoom,
  customerOwnsIssue,
  customerOwnsConsultation,
  expertIsAssignedToIssue,
  expertIsAssignedToConsultation,
};
