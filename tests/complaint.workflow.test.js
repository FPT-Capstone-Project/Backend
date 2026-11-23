const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

test('harvest complaint ownership, delivery eligibility, replies and resolution', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const previous = require.cache[dbPath];
  const client = { query: (sql, values) => db.query(sql, values), release() {} };
  require.cache[dbPath] = { exports: { ...client, connect: async () => client } };
  const modelPath = require.resolve('../src/models/complaint.model');
  delete require.cache[modelPath];
  const model = require(modelPath);
  try {
    await db.exec(`
      CREATE TABLE users (user_id INT PRIMARY KEY, full_name TEXT, role_id INT, status TEXT);
      CREATE TABLE orders (order_id INT PRIMARY KEY, user_id INT);
      CREATE TABLE shipments (shipment_id INT PRIMARY KEY, order_id INT, status TEXT, delivered_at TIMESTAMPTZ);
      CREATE TABLE order_items (order_item_id INT PRIMARY KEY, order_id INT);
      CREATE TABLE cultivation_sessions (session_id INT PRIMARY KEY, order_item_id INT);
      CREATE TABLE harvest_requests (session_id INT, harvest_method TEXT);
      CREATE TABLE complaints (complaint_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        shipment_id INT UNIQUE REFERENCES shipments, customer_id INT, complaint_type VARCHAR(100),
        description TEXT, image_urls JSONB DEFAULT '[]', status VARCHAR(30) DEFAULT 'PENDING', assigned_to INT,
        resolution TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ);
      CREATE TABLE complaint_replies (reply_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        complaint_id INT REFERENCES complaints, sender_id INT, message TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE notifications (user_id INT, notification_type TEXT, title TEXT, message TEXT,
        created_by INT, reference_type TEXT, reference_id INT);
      INSERT INTO users VALUES (1,'Staff',1,'ACTIVE'), (2,'Owner',3,'ACTIVE'), (3,'Other',3,'ACTIVE'),
        (4,'Operator',2,'ACTIVE'), (5,'Other operator',2,'ACTIVE');
      INSERT INTO orders VALUES (1,2);
      INSERT INTO shipments VALUES (1,1,'DELIVERED'), (2,1,'PENDING');
      INSERT INTO order_items VALUES (1,1);
      INSERT INTO cultivation_sessions VALUES (1,1);
      INSERT INTO harvest_requests VALUES (1,'DELIVERY');
    `);
    await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/034_harvest_delivery_complaints.sql'), 'utf8'));
    await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/035_complaints_reference_orders.sql'), 'utf8'));
    await db.exec(`ALTER TABLE complaints DROP CONSTRAINT complaints_status_check;
      ALTER TABLE complaints ALTER COLUMN status SET DEFAULT 'PENDING';
      ALTER TABLE complaints ADD CONSTRAINT chk_complaints_status CHECK (status IN (
        'PENDING','UNDER_REVIEW','NEED_MORE_INFO','RESOLVING','RESOLVED','REJECTED','CLOSED'
      ));`);
    const owner = { user_id: 2, role_id: 3 };
    const other = { user_id: 3, role_id: 3 };
    const staff = { user_id: 1, role_id: 1 };
    const operator = { user_id: 4, role_id: 2 };
    const otherOperator = { user_id: 5, role_id: 2 };
    const data = { orderId: 1, type: 'DAMAGED', description: 'Damaged mushrooms' };
    let uploads = 0;
    const upload = async () => { uploads++; return ['https://example.test/image.jpg']; };
    await assert.rejects(model.create(data, other, upload), { statusCode: 404 });
    await assert.rejects(model.create({ ...data, orderId: 99 }, owner, upload), { statusCode: 404 });
    await assert.rejects(model.create(data, owner, upload), { statusCode: 409 });
    await db.query("UPDATE shipments SET status = 'DELIVERED', delivered_at = NOW() - INTERVAL '3 days' WHERE shipment_id = 2");
    await db.query("UPDATE harvest_requests SET harvest_method = 'PICKUP'");
    await assert.rejects(model.create(data, owner, upload), { statusCode: 409 });
    await db.query("UPDATE harvest_requests SET harvest_method = 'DELIVERY'");
    await assert.rejects(model.create(data, owner, upload), { statusCode: 409 });
    await db.query("UPDATE shipments SET delivered_at = NOW() WHERE shipment_id = 2");
    assert.equal(uploads, 0);
    assert.equal((await db.query('SELECT * FROM notifications')).rows.length, 0);
    await db.exec("ALTER TABLE notifications ADD CONSTRAINT reject_confirmation CHECK (title <> 'Đã gửi khiếu nại')");
    await assert.rejects(model.create(data, owner, async () => []));
    assert.equal((await db.query('SELECT * FROM complaints')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM notifications')).rows.length, 0);
    await db.exec('ALTER TABLE notifications DROP CONSTRAINT reject_confirmation');
    const complaint = await model.create(data, owner, upload);
    assert.equal(complaint.status, 'PENDING');
    assert.equal(complaint.order_id, 1);
    assert.equal(complaint.shipment_id, undefined);
    assert.deepEqual(complaint.image_urls, ['https://example.test/image.jpg']);
    const confirmation = await db.query('SELECT * FROM notifications WHERE user_id = $1', [owner.user_id]);
    assert.equal(confirmation.rows.length, 1);
    assert.equal(confirmation.rows[0].title, 'Đã gửi khiếu nại');
    assert.equal(confirmation.rows[0].reference_type, 'COMPLAINT');
    assert.equal(confirmation.rows[0].reference_id, complaint.complaint_id);
    await assert.rejects(model.create(data, owner, upload), { statusCode: 409 });
    assert.equal((await db.query('SELECT * FROM notifications WHERE user_id = $1', [owner.user_id])).rows.length, 1);
    assert.equal(uploads, 1);
    await assert.rejects(model.detail(complaint.complaint_id, other), { statusCode: 404 });
    assert.equal((await model.list(other, { limit: 20, offset: 0, mine: true })).total, 0);
    assert.equal((await model.list(staff, { limit: 20, offset: 0 })).total, 1);
    const unassignedComplaints = await model.list(operator, {
      limit: 20,
      offset: 0,
      queue: 'UNASSIGNED',
    });
    assert.equal(unassignedComplaints.total, 1);
    assert.equal('description' in unassignedComplaints.data[0], false);
    assert.equal('image_urls' in unassignedComplaints.data[0], false);
    assert.equal('order' in unassignedComplaints.data[0], false);
    assert.equal((await model.list(operator, { limit: 20, offset: 0, queue: 'ASSIGNED' })).total, 0);
    await assert.rejects(model.update(complaint.complaint_id, { status: 'RESOLVED' }, staff), { statusCode: 400 });
    const resolved = await model.update(complaint.complaint_id, { status: 'RESOLVED', resolution: 'Direct resolution' }, staff);
    assert.ok(resolved.resolved_at);
    const reopened = await model.update(complaint.complaint_id, { status: 'PENDING' }, staff);
    assert.equal(reopened.status, 'PENDING');
    assert.equal(reopened.resolved_at, null);
    await model.update(complaint.complaint_id, { status: 'REJECTED', resolution: 'Test rejection' }, staff);
    await model.update(complaint.complaint_id, { status: 'PENDING' }, staff);
    await db.query('UPDATE complaints SET resolution = NULL WHERE complaint_id = $1', [complaint.complaint_id]);
    await assert.rejects(model.update(complaint.complaint_id, { assignedTo: 3 }, staff), { statusCode: 400 });
    await model.update(complaint.complaint_id, { status: 'UNDER_REVIEW', assignedTo: 1 }, staff);
    await model.reply(complaint.complaint_id, 'Please provide details', staff);
    await model.update(complaint.complaint_id, { status: 'NEED_MORE_INFO' }, staff);
    await assert.rejects(model.reply(complaint.complaint_id, 'Intrusion', other), { statusCode: 404 });
    await model.reply(
      complaint.complaint_id,
      'More details',
      owner,
      async () => ['https://example.test/additional-evidence.jpg'],
    );
    const detail = await model.detail(complaint.complaint_id, owner);
    assert.equal(detail.status, 'UNDER_REVIEW');
    assert.deepEqual(detail.image_urls, [
      'https://example.test/image.jpg',
      'https://example.test/additional-evidence.jpg',
    ]);
    assert.equal(detail.order.order_id, 1);
    assert.equal(detail.replies[1].sender_id, 2);
    assert.equal(detail.assigned_staff.user_id, 1);
    await assert.rejects(
      model.reply(complaint.complaint_id, 'Unrequested update', owner),
      { statusCode: 409 },
    );
    await model.update(complaint.complaint_id, { assignedTo: operator.user_id }, staff);
    assert.equal((await model.list(operator, { limit: 20, offset: 0, queue: 'UNASSIGNED' })).total, 0);
    assert.equal((await model.list(operator, { limit: 20, offset: 0, queue: 'ASSIGNED' })).total, 1);
    assert.equal((await model.list(otherOperator, { limit: 20, offset: 0, queue: 'ASSIGNED' })).total, 0);
    await assert.rejects(model.detail(complaint.complaint_id, otherOperator), { statusCode: 404 });
    await assert.rejects(
      model.update(complaint.complaint_id, { status: 'RESOLVED', resolution: 'Unauthorized' }, otherOperator),
      { statusCode: 404 },
    );
    assert.equal(
      (await model.update(complaint.complaint_id, { status: 'UNDER_REVIEW' }, operator)).status,
      'UNDER_REVIEW',
    );
    assert.equal(
      (await model.update(complaint.complaint_id, { status: 'NEED_MORE_INFO' }, operator)).status,
      'NEED_MORE_INFO',
    );
    await assert.rejects(
      model.update(complaint.complaint_id, { status: 'REJECTED', resolution: 'Rejected' }, operator),
      { statusCode: 400 },
    );
    await assert.rejects(
      model.update(complaint.complaint_id, { status: 'CLOSED', resolution: 'Closed' }, operator),
      { statusCode: 400 },
    );
    const beforeReply = (await db.query('SELECT * FROM notifications WHERE user_id = $1', [owner.user_id])).rows.length;
    await db.exec("ALTER TABLE notifications ADD CONSTRAINT reject_operator_notification CHECK (title <> 'Khiếu nại đã có phản hồi')");
    await assert.rejects(model.reply(complaint.complaint_id, 'Operator reply', operator));
    assert.equal((await db.query('SELECT * FROM complaint_replies')).rows.length, 2);
    assert.equal((await db.query('SELECT * FROM notifications WHERE user_id = $1', [owner.user_id])).rows.length, beforeReply);
    await db.exec('ALTER TABLE notifications DROP CONSTRAINT reject_operator_notification');
    await model.reply(complaint.complaint_id, 'Operator reply', operator);
    assert.equal(
      (await model.update(complaint.complaint_id, { status: 'RESOLVING' }, operator)).status,
      'RESOLVING',
    );
    const operatorNotifications = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 AND title = $2',
      [owner.user_id, 'Khiếu nại đã có phản hồi']);
    assert.equal(operatorNotifications.rows.length, 1);
    assert.match(operatorNotifications.rows[0].message, /Nhân viên trang trại đã phản hồi/);
    assert.equal(operatorNotifications.rows[0].created_by, operator.user_id);
    assert.equal(operatorNotifications.rows[0].reference_id, complaint.complaint_id);
    const operatorResolution = await model.update(
      complaint.complaint_id,
      { status: 'RESOLVED', resolution: 'Replacement proposed' },
      operator,
    );
    assert.ok(operatorResolution.resolved_at);
    const resolutionNotifications = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 AND title = $2',
      [owner.user_id, 'Khiếu nại đã có phản hồi']);
    assert.equal(resolutionNotifications.rows.length, 2);
    assert.match(resolutionNotifications.rows[1].message, /cập nhật nội dung xử lý/);
    assert.equal((await model.list(otherOperator, { limit: 20, offset: 0, queue: 'RESPONDED' })).total, 1);
    assert.ok((await model.detail(complaint.complaint_id, otherOperator)).resolved_at);
    await assert.rejects(
      model.update(complaint.complaint_id, { status: 'RESOLVED', resolution: 'Second response' }, operator),
      { statusCode: 409 },
    );
    assert.equal((await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 AND title = $2',
      [owner.user_id, 'Khiếu nại đã có phản hồi'])).rows.length, 2);
    await db.query('UPDATE complaints SET resolution = NULL WHERE complaint_id = $1', [complaint.complaint_id]);
    await assert.rejects(model.update(complaint.complaint_id, { status: 'RESOLVED' }, staff), { statusCode: 400 });
    await model.update(complaint.complaint_id, { status: 'RESOLVED', resolution: 'Replacement delivered' }, staff);
    await assert.rejects(model.reply(complaint.complaint_id, 'Late reply', owner), { statusCode: 409 });
    assert.ok((await model.detail(complaint.complaint_id, owner)).resolved_at);
    await db.query('UPDATE complaints SET resolution = NULL WHERE complaint_id = $1', [complaint.complaint_id]);
    await assert.rejects(model.update(complaint.complaint_id, { status: 'CLOSED' }, staff), { statusCode: 400 });
    const closed = await model.update(complaint.complaint_id, { status: 'CLOSED', resolution: 'Complaint closed' }, staff);
    assert.ok(closed.resolved_at);
    await assert.rejects(model.reply(complaint.complaint_id, 'Late reply', owner), { statusCode: 409 });
    assert.ok((await db.query('SELECT * FROM notifications WHERE user_id = 1')).rows.length);
  } finally {
    if (previous) require.cache[dbPath] = previous;
    else delete require.cache[dbPath];
    delete require.cache[modelPath];
    await db.close();
  }
});
