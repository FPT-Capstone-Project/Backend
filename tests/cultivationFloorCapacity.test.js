const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { assertCultivationCapacity } = require('../src/models/cultivationReservation.model');

test('WF-01 counts valid trays on floor 1 or 3 without mushroom profiles, never combined floors', async () => {
  const db = new PGlite();
  const request = { orderItemId: 0, mushroomTypeId: 8, trayQuantity: 5 };
  try {
    await db.exec(`
      CREATE TABLE cultivation_floors(floor_id INT PRIMARY KEY, room_id INT, status TEXT);
      CREATE TABLE tray_positions(position_id INT PRIMARY KEY, floor_id INT, room_id INT, status TEXT);
      CREATE TABLE cultivation_trays(tray_id INT PRIMARY KEY, floor_id INT, room_id INT, position_id INT, status TEXT);
      CREATE TABLE cultivation_session_trays(tray_id INT, status TEXT);
      CREATE TABLE orders(order_id INT, status TEXT, payment_status TEXT);
      CREATE TABLE order_items(order_item_id INT, order_id INT, mushroom_type_id INT);
      CREATE TABLE tray_reservations(order_item_id INT, quantity INT, spawn_quantity INT, status TEXT, expires_at TIMESTAMPTZ);
      CREATE TABLE spawn_inventory(inventory_id INT, mushroom_type_id INT, quantity NUMERIC);
      INSERT INTO cultivation_floors VALUES(1,1,'ACTIVE'),(3,1,'ACTIVE'),(5,1,'ACTIVE');
      INSERT INTO tray_positions SELECT n,CASE WHEN n<=9 THEN 1 ELSE 3 END,1,'ACTIVE' FROM generate_series(1,18) n;
      INSERT INTO cultivation_trays SELECT position_id,floor_id,room_id,position_id,'AVAILABLE' FROM tray_positions;
      INSERT INTO tray_positions SELECT n,5,1,'ACTIVE' FROM generate_series(19,38) n;
      INSERT INTO cultivation_trays SELECT position_id,floor_id,room_id,position_id,'AVAILABLE'
        FROM tray_positions WHERE floor_id=5;
      INSERT INTO spawn_inventory VALUES(1,8,100);
    `);
    const capacity = () => assertCultivationCapacity(db, request);
    assert.equal((await capacity()).availableTrayQuantity, 9);
    await assert.rejects(() => assertCultivationCapacity(db, { ...request, trayQuantity: 10 }),
      { code: 'INSUFFICIENT_TRAYS', statusCode: 409, message: 'Only 9 cultivation trays are currently available' });
    await db.exec("UPDATE cultivation_floors SET status='INACTIVE' WHERE floor_id=3; UPDATE cultivation_trays SET position_id=NULL WHERE tray_id=1");
    assert.equal((await capacity()).availableTrayQuantity, 8);
    await db.exec("UPDATE tray_positions SET status='INACTIVE' WHERE position_id=2");
    assert.equal((await capacity()).availableTrayQuantity, 7);
    await db.exec("UPDATE cultivation_trays SET status='INACTIVE' WHERE tray_id=3");
    assert.equal((await capacity()).availableTrayQuantity, 6);
    await db.exec('UPDATE tray_positions SET room_id=2 WHERE position_id=4');
    assert.equal((await capacity()).availableTrayQuantity, 5);
    await db.exec(`
      INSERT INTO orders VALUES(1,'PENDING','UNPAID');
      INSERT INTO order_items VALUES(1,1,8);
      INSERT INTO tray_reservations VALUES(1,1,2,'HELD',now()+interval '15 minutes');`);
    await assert.rejects(capacity, { code: 'INSUFFICIENT_TRAYS', message: 'Only 4 cultivation trays are currently available' });
    await db.exec("UPDATE tray_reservations SET expires_at=now()-interval '1 minute'; UPDATE spawn_inventory SET quantity=9");
    await assert.rejects(capacity, { code: 'INSUFFICIENT_SPAWN', statusCode: 409 });
    await db.exec("UPDATE spawn_inventory SET quantity=100; UPDATE cultivation_floors SET status='INACTIVE' WHERE floor_id=1");
    await assert.rejects(capacity, { code: 'INSUFFICIENT_TRAYS' });
  } finally {
    await db.close();
  }
});
