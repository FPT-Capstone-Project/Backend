const pool = require('../config/db');
const AppError = require('../utils/app-error');

const isStaff = (actor) => [1, 2].includes(Number(actor.role_id));

async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function ownedComplaint(client, id, actor, lock = false) {
  const { rows } = await client.query(
    `SELECT c.* FROM complaints c JOIN orders o USING (order_id)
     WHERE c.complaint_id = $1 AND (
       $2::boolean
       OR ($3::boolean AND (
         c.assigned_to IS NULL OR c.assigned_to = $4 OR c.resolved_at IS NOT NULL
         OR c.status IN ('RESOLVED', 'REJECTED', 'CLOSED')
       ))
       OR (c.customer_id = $4 AND o.user_id = $4)
     )
     ${lock ? 'FOR UPDATE OF c' : ''}`,
    [id, Number(actor.role_id) === 1, Number(actor.role_id) === 2, actor.user_id]);
  if (!rows[0]) throw new AppError('Complaint not found', 404);
  return rows[0];
}

async function notify(client, complaint, actor, message, title = 'Harvest delivery complaint') {
  await client.query(
    `INSERT INTO notifications (user_id, notification_type, title, message, created_by, reference_type, reference_id)
     SELECT user_id, 'COMPLAINT_UPDATE', $7, $1, $2, 'COMPLAINT', $3
     FROM users WHERE status = 'ACTIVE' AND user_id <> $2 AND
       (($4::boolean AND user_id = $5) OR (NOT $4::boolean AND
         (($6::integer IS NOT NULL AND user_id = $6) OR ($6::integer IS NULL AND role_id IN (1, 2)))))`,
    [message, actor.user_id, complaint.complaint_id, isStaff(actor), complaint.customer_id, complaint.assigned_to, title]);
}

async function create(data, actor, uploadImages) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT o.order_id, EXISTS (
         SELECT 1 FROM harvest_requests hr JOIN cultivation_sessions s USING (session_id)
         JOIN order_items oi USING (order_item_id)
         WHERE oi.order_id = o.order_id AND hr.harvest_method = 'DELIVERY'
       ) AS harvest_delivery
       FROM orders o WHERE o.order_id = $1 AND o.user_id = $2 FOR UPDATE OF o`,
      [data.orderId, actor.user_id]);
    const order = rows[0];
    if (!order) throw new AppError('Order not found', 404);
    const shipment = await client.query(
      `SELECT status, delivered_at FROM shipments WHERE order_id = $1
       ORDER BY shipment_id DESC LIMIT 1 FOR UPDATE`, [data.orderId]);
    const deliveredAt = shipment.rows[0]?.delivered_at
      ? new Date(shipment.rows[0].delivered_at).getTime()
      : Number.NaN;
    const complaintDeadline = Number.isFinite(deliveredAt)
      ? deliveredAt + (2 * 24 * 60 * 60 * 1000)
      : 0;
    if (!order.harvest_delivery || shipment.rows[0]?.status !== 'DELIVERED'
      || complaintDeadline < Date.now()) {
      throw new AppError('Only delivered harvested mushroom shipments can be complained about', 409);
    }
    const existing = await client.query('SELECT complaint_id FROM complaints WHERE order_id = $1', [data.orderId]);
    if (existing.rows.length) throw new AppError('Order already has a complaint', 409);
    const images = await uploadImages();
    const result = await client.query(
      `INSERT INTO complaints (order_id, customer_id, complaint_type, description, image_urls, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'PENDING') RETURNING *`,
      [data.orderId, actor.user_id, data.type, data.description, JSON.stringify(images)]);
    await client.query(
      `INSERT INTO notifications (user_id, notification_type, title, message, created_by, reference_type, reference_id)
       VALUES ($1, 'COMPLAINT_UPDATE', $2, $3, $1, 'COMPLAINT', $4)`,
      [actor.user_id, 'Đã gửi khiếu nại',
        `Khiếu nại #${result.rows[0].complaint_id} của đơn hàng #${data.orderId} đã được gửi thành công.`,
        result.rows[0].complaint_id]);
    await notify(client, result.rows[0], actor, 'A customer submitted a harvest delivery complaint.');
    return result.rows[0];
  });
}

async function list(actor, { status, limit, offset, mine, queue }) {
  const values = [!mine && isStaff(actor), actor.user_id, status || null, Number(actor.role_id), queue || null];
  const where = `FROM complaints c JOIN orders o USING (order_id)
    LEFT JOIN users customer ON customer.user_id = c.customer_id
    WHERE ($1::boolean OR (c.customer_id = $2 AND o.user_id = $2))
      AND ($3::text IS NULL OR c.status = $3)
      AND ($4::integer <> 2 OR CASE $5::text
        WHEN 'UNASSIGNED' THEN c.assigned_to IS NULL AND c.resolved_at IS NULL
          AND c.status NOT IN ('RESOLVED', 'REJECTED', 'CLOSED')
        WHEN 'ASSIGNED' THEN c.assigned_to = $2 AND c.resolved_at IS NULL
          AND c.status NOT IN ('RESOLVED', 'REJECTED', 'CLOSED')
        WHEN 'RESPONDED' THEN c.resolved_at IS NOT NULL
          OR c.status IN ('RESOLVED', 'REJECTED', 'CLOSED')
        ELSE c.assigned_to IS NULL OR c.assigned_to = $2
          OR c.resolved_at IS NOT NULL OR c.status IN ('RESOLVED', 'REJECTED', 'CLOSED')
      END)`;
  const count = await pool.query(`SELECT COUNT(*)::integer AS total ${where}`, values);
  const result = await pool.query(`SELECT c.complaint_id, c.order_id, c.customer_id,
      c.complaint_type, c.status, c.assigned_to, c.created_at, c.updated_at, c.resolved_at,
      customer.full_name AS customer_name ${where}
    ORDER BY c.created_at DESC, c.complaint_id DESC LIMIT $6 OFFSET $7`,
  [...values, limit, offset]);
  return { data: result.rows, total: count.rows[0].total };
}

async function detail(id, actor) {
  const complaint = await ownedComplaint(pool, id, actor);
  const order = await pool.query('SELECT * FROM orders WHERE order_id = $1', [complaint.order_id]);
  const replies = await pool.query(`SELECT r.*, u.full_name AS sender_name, u.role_id AS sender_role_id
    FROM complaint_replies r JOIN users u ON u.user_id = r.sender_id
    WHERE complaint_id = $1 ORDER BY created_at, reply_id`, [id]);
  const staff = await pool.query('SELECT user_id, full_name, role_id FROM users WHERE user_id = $1', [complaint.assigned_to]);
  return { ...complaint, order: order.rows[0], replies: replies.rows, assigned_staff: staff.rows[0] || null };
}

async function reply(id, message, actor, uploadImages = async () => []) {
  return transaction(async (client) => {
    const complaint = await ownedComplaint(client, id, actor, true);
    if (Number(actor.role_id) === 2 && complaint.assigned_to !== Number(actor.user_id)) {
      throw new AppError('Complaint is not assigned to this operator', 404);
    }
    if (Number(actor.role_id) === 2 && complaint.resolved_at) {
      throw new AppError('Complaint has already been resolved', 409);
    }
    if (['RESOLVED', 'REJECTED', 'CLOSED'].includes(complaint.status)) throw new AppError('Complaint no longer accepts replies', 409);
    if (Number(actor.role_id) === 3 && complaint.status !== 'NEED_MORE_INFO') {
      throw new AppError('Additional information is accepted only when the complaint requests it', 409);
    }
    const imageUrls = await uploadImages();
    const result = await client.query(`INSERT INTO complaint_replies (complaint_id, sender_id, message)
      VALUES ($1, $2, $3) RETURNING *`, [id, actor.user_id, message]);
    await client.query(`UPDATE complaints SET updated_at = CURRENT_TIMESTAMP,
      image_urls = CASE WHEN $3::jsonb = '[]'::jsonb THEN image_urls ELSE image_urls || $3::jsonb END,
      status = CASE WHEN status = 'NEED_MORE_INFO' AND $2::boolean THEN 'UNDER_REVIEW' ELSE status END
      WHERE complaint_id = $1`, [id, !isStaff(actor), JSON.stringify(imageUrls)]);
    if (Number(actor.role_id) === 2) {
      await notify(client, complaint, actor,
        `Nhân viên trang trại đã phản hồi khiếu nại #${id} của bạn.`,
        'Khiếu nại đã có phản hồi');
    } else {
      await notify(client, complaint, actor, 'A new reply was added to your harvest delivery complaint.');
    }
    return result.rows[0];
  });
}

async function update(id, data, actor) {
  return transaction(async (client) => {
    const complaint = await ownedComplaint(client, id, actor, true);
    if (Number(actor.role_id) === 2) {
      if (complaint.assigned_to !== Number(actor.user_id)) {
        throw new AppError('Complaint is not assigned to this operator', 404);
      }
      if (complaint.resolved_at || ['RESOLVED', 'REJECTED', 'CLOSED'].includes(complaint.status)) {
        throw new AppError('Complaint has already been resolved', 409);
      }
      if (data.assignedTo !== undefined) {
        throw new AppError('Only admins can assign complaints', 403);
      }
      const allowedStatuses = ['UNDER_REVIEW', 'NEED_MORE_INFO', 'RESOLVING', 'RESOLVED'];
      if (!allowedStatuses.includes(data.status)) {
        throw new AppError('Assigned operators may only update an active complaint status or resolve it', 400);
      }
      if (data.status === 'RESOLVED' && data.resolution === undefined) {
        throw new AppError('A resolution is required to resolve the complaint', 400);
      }
    }
    const assigned = data.assignedTo === undefined ? complaint.assigned_to : data.assignedTo;
    if (assigned !== null) {
      const staff = await client.query("SELECT user_id FROM users WHERE user_id = $1 AND role_id IN (1, 2) AND status = 'ACTIVE'", [assigned]);
      if (!staff.rows.length) throw new AppError('assigned_to must be active farm staff', 400);
    }
    const status = data.status || complaint.status;
    const resolution = data.resolution === undefined ? complaint.resolution : data.resolution;
    if (['RESOLVED', 'REJECTED', 'CLOSED'].includes(status) && !resolution?.trim()) {
      throw new AppError('A resolution is required for a final status', 400);
    }
    const result = await client.query(`UPDATE complaints SET status = $2, assigned_to = $3, resolution = $4,
      updated_at = CURRENT_TIMESTAMP, resolved_at = CASE WHEN $2::varchar IN ('RESOLVED', 'CLOSED')
      THEN COALESCE(resolved_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE complaint_id = $1 RETURNING *`,
    [id, status, assigned, resolution]);
    if (Number(actor.role_id) === 2 && data.resolution !== undefined && data.resolution !== complaint.resolution) {
      await notify(client, result.rows[0], actor,
        `Nhân viên trang trại đã cập nhật nội dung xử lý khiếu nại #${id} của bạn.`,
        'Khiếu nại đã có phản hồi');
    } else {
      await notify(client, result.rows[0], actor, 'Your harvest delivery complaint was updated.');
    }
    return result.rows[0];
  });
}

module.exports = { create, list, detail, reply, update };
