const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const migration = require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/034_harvest_delivery_complaints.sql'), 'utf8');
const orderMigration = require('node:fs').readFileSync(require('node:path').join(__dirname, '../migrations/035_complaints_reference_orders.sql'), 'utf8');

test('complaint migration creates tables, converts legacy statuses and can be rerun', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE users (user_id INT PRIMARY KEY); CREATE TABLE orders (order_id INT PRIMARY KEY); CREATE TABLE shipments (shipment_id INT PRIMARY KEY, order_id INT REFERENCES orders);');
    await db.exec(migration);
    await db.exec(`INSERT INTO users VALUES (1); INSERT INTO orders VALUES (10); INSERT INTO shipments VALUES (1,10), (2,10);
      ALTER TABLE complaints DROP CONSTRAINT complaints_status_check;
      ALTER TABLE complaints ADD CONSTRAINT legacy_status_check CHECK (status IN ('PENDING','CLOSED'));
      INSERT INTO complaints (shipment_id,customer_id,complaint_type,description,status) VALUES (1,1,'DAMAGED','Broken','PENDING');`);
    await db.exec(migration);
    assert.equal((await db.query('SELECT status FROM complaints')).rows[0].status, 'OPEN');
    await assert.rejects(db.query("UPDATE complaints SET status = 'PENDING'"));
    await db.exec(migration);
    await db.query("INSERT INTO complaint_replies (complaint_id,sender_id,message) VALUES (1,1,'More information')");
    assert.equal((await db.query('SELECT count(*)::int AS total FROM complaint_replies')).rows[0].total, 1);
    await db.query("INSERT INTO complaints (shipment_id,customer_id,complaint_type,description) VALUES (2,1,'MISSING','Missing mushrooms')");
    await db.exec(orderMigration);
    const complaints = (await db.query('SELECT * FROM complaints ORDER BY complaint_id')).rows;
    assert.equal(complaints.length, 2);
    assert.deepEqual(complaints.map((c) => c.order_id), [10, 10]);
    assert.equal(complaints[0].description, 'Broken');
    assert.equal(complaints[0].shipment_id, undefined);
    assert.equal((await db.query('SELECT message FROM complaint_replies WHERE complaint_id = 1')).rows[0].message, 'More information');
    await assert.rejects(db.query('UPDATE complaints SET order_id = NULL'));
    await assert.rejects(db.query('UPDATE complaints SET order_id = 999'));
  } finally { await db.close(); }
});
