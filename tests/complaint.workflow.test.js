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
      CREATE TABLE shipments (shipment_id INT PRIMARY KEY, order_id INT, status TEXT);
      CREATE TABLE order_items (order_item_id INT PRIMARY KEY, order_id INT);
      CREATE TABLE cultivation_sessions (session_id INT PRIMARY KEY, order_item_id INT);
      CREATE TABLE harvest_requests (session_id INT, harvest_method TEXT);
      CREATE TABLE complaints (complaint_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        shipment_id INT UNIQUE REFERENCES shipments, customer_id INT, complaint_type VARCHAR(100),
        description TEXT, image_urls JSONB DEFAULT '[]', status TEXT DEFAULT 'PENDING', assigned_to INT,
        resolution TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), resolved_at TIMESTAMPTZ);
      CREATE TABLE complaint_replies (reply_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        complaint_id INT REFERENCES complaints, sender_id INT, message TEXT, created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE notifications (user_id INT, notification_type TEXT, title TEXT, message TEXT,
        created_by INT, reference_type TEXT, reference_id INT);
      INSERT INTO users VALUES (1,'Staff',1,'ACTIVE'), (2,'Owner',3,'ACTIVE'), (3,'Other',3,'ACTIVE');
      INSERT INTO orders VALUES (1,2);
      INSERT INTO shipments VALUES (1,1,'DELIVERED'), (2,1,'PENDING');
      INSERT INTO order_items VALUES (1,1);
      INSERT INTO cultivation_sessions VALUES (1,1);
      INSERT INTO harvest_requests VALUES (1,'DELIVERY');
    `);
    await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/034_harvest_delivery_complaints.sql'), 'utf8'));
    await db.exec(require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/035_complaints_reference_orders.sql'), 'utf8'));
    const owner = { user_id: 2, role_id: 3 };
    const other = { user_id: 3, role_id: 3 };
    const staff = { user_id: 1, role_id: 1 };
    const data = { orderId: 1, type: 'DAMAGED', description: 'Damaged mushrooms' };
    let uploads = 0;
    const upload = async () => { uploads++; return ['https://example.test/image.jpg']; };
    await assert.rejects(model.create(data, other, upload), { statusCode: 404 });
    await assert.rejects(model.create({ ...data, orderId: 99 }, owner, upload), { statusCode: 404 });
    await assert.rejects(model.create(data, owner, upload), { statusCode: 409 });
    await db.query("UPDATE shipments SET status = 'DELIVERED' WHERE shipment_id = 2");
    await db.query("UPDATE harvest_requests SET harvest_method = 'PICKUP'");
    await assert.rejects(model.create(data, owner, upload), { statusCode: 409 });
    await db.query("UPDATE harvest_requests SET harvest_method = 'DELIVERY'");
    assert.equal(uploads, 0);
    const complaint = await model.create(data, owner, upload);
    assert.equal(complaint.status, 'OPEN');
    assert.equal(complaint.order_id, 1);
    assert.equal(complaint.shipment_id, undefined);
    assert.deepEqual(complaint.image_urls, ['https://example.test/image.jpg']);
    await assert.rejects(model.create(data, owner, upload), { statusCode: 409 });
    assert.equal(uploads, 1);
    await assert.rejects(model.detail(complaint.complaint_id, other), { statusCode: 404 });
    assert.equal((await model.list(other, { limit: 20, offset: 0, mine: true })).total, 0);
    assert.equal((await model.list(staff, { limit: 20, offset: 0 })).total, 1);
    await assert.rejects(model.update(complaint.complaint_id, { status: 'RESOLVED' }, staff), { statusCode: 400 });
    const resolved = await model.update(complaint.complaint_id, { status: 'RESOLVED', resolution: 'Direct resolution' }, staff);
    assert.ok(resolved.resolved_at);
    const reopened = await model.update(complaint.complaint_id, { status: 'OPEN' }, staff);
    assert.equal(reopened.status, 'OPEN');
    assert.equal(reopened.resolved_at, null);
    await model.update(complaint.complaint_id, { status: 'REJECTED', resolution: 'Test rejection' }, staff);
    await model.update(complaint.complaint_id, { status: 'OPEN' }, staff);
    await db.query('UPDATE complaints SET resolution = NULL WHERE complaint_id = $1', [complaint.complaint_id]);
    await assert.rejects(model.update(complaint.complaint_id, { assignedTo: 3 }, staff), { statusCode: 400 });
    await model.update(complaint.complaint_id, { status: 'IN_PROGRESS', assignedTo: 1 }, staff);
    await model.reply(complaint.complaint_id, 'Please provide details', staff);
    await model.update(complaint.complaint_id, { status: 'WAITING_CUSTOMER' }, staff);
    await assert.rejects(model.reply(complaint.complaint_id, 'Intrusion', other), { statusCode: 404 });
    await model.reply(complaint.complaint_id, 'More details', owner);
    const detail = await model.detail(complaint.complaint_id, owner);
    assert.equal(detail.status, 'IN_PROGRESS');
    assert.equal(detail.order.order_id, 1);
    assert.equal(detail.replies[1].sender_id, 2);
    assert.equal(detail.assigned_staff.user_id, 1);
    await assert.rejects(model.update(complaint.complaint_id, { status: 'RESOLVED' }, staff), { statusCode: 400 });
    await model.update(complaint.complaint_id, { status: 'RESOLVED', resolution: 'Replacement delivered' }, staff);
    await assert.rejects(model.reply(complaint.complaint_id, 'Late reply', owner), { statusCode: 409 });
    assert.ok((await model.detail(complaint.complaint_id, owner)).resolved_at);
    assert.ok((await db.query('SELECT * FROM notifications WHERE user_id = 1')).rows.length);
  } finally {
    if (previous) require.cache[dbPath] = previous;
    else delete require.cache[dbPath];
    delete require.cache[modelPath];
    await db.close();
  }
});
