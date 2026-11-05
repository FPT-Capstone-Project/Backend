const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const express = require('express');
const jwt = require('jsonwebtoken');

test('sensor fault notification and repair workflow uses actual floor owners and operator authorization', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const previous = require.cache[dbPath];
  let server;
  try {
    await db.exec(fs.readFileSync('database.sql', 'utf8'));
    await db.exec(fs.readFileSync('migrations/020_device_incidents.sql', 'utf8'));
    await db.exec(`
      INSERT INTO roles(role_name) VALUES ('Admin'),('Farm Operator'),('Customer');
      INSERT INTO users(role_id,email,password_hash,full_name) VALUES
        (1,'a@test','x','Admin'),(2,'o@test','x','Operator'),(3,'c@test','x','Customer'),
        (3,'other@test','x','Other floor'),(2,'o2@test','x','Operator 2');
      INSERT INTO cultivation_rooms(room_code,room_name) VALUES ('R1','Room');
      INSERT INTO iot_masters(master_identifier,cultivation_room_id,last_seen_at) VALUES ('master1',1,now());
      INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel,updated_at)
        VALUES (1,1,'Tầng 1',1,1,1,now()-interval '2 minutes'),
          (1,2,'Tầng 2',1,2,2,now()-interval '2 minutes');
      INSERT INTO cultivation_trays(room_id,tray_code,floor_id) VALUES (1,'T1',1),(1,'T2',2),(1,'T3',1),(1,'T4',1);
      INSERT INTO mushroom_types(name,growing_days) VALUES ('Mushroom',25);
      INSERT INTO orders(user_id) VALUES (3),(4);
      INSERT INTO order_items(order_id,mushroom_type_id,unit_price,total_price) VALUES (1,1,100,100),(2,1,100,100);
      INSERT INTO cultivation_sessions(mushroom_type_id,start_at,order_item_id,status)
        VALUES (1,now(),1,'CULTIVATING'),(1,now(),2,'CULTIVATING'),(1,now(),2,'COMPLETED');
      INSERT INTO cultivation_session_trays(session_id,tray_id,status)
        VALUES (1,1,'ACTIVE'),(1,3,'ACTIVE'),(2,2,'ACTIVE'),(2,3,'RELEASED'),(3,4,'ACTIVE');
      INSERT INTO iot_sensor_latest(master_id,node_address,sensor_address,temperature,humidity,is_valid,last_received_at)
        SELECT 1,n,s,25,80,true,now() FROM generate_series(1,2) n CROSS JOIN generate_series(1,3) s;
      UPDATE iot_sensor_latest SET is_valid=false WHERE node_address=1 AND sensor_address=1;
    `);
    require.cache[dbPath] = { exports: {
      query: (...args) => db.query(...args),
      connect: async () => ({ query: (...args) => db.query(...args), release() {} }),
    } };
    const model = require('../src/models/deviceIncident.model');
    assert.deepEqual(await model.scan(), { created: 1 });
    assert.deepEqual(await model.scan(), { created: 0 });
    const alerts = (await db.query('SELECT * FROM notifications ORDER BY user_id')).rows;
    assert.deepEqual(alerts.map(n => n.user_id), [1,2,3,5]);
    assert.match(alerts[2].message, /Nhân viên đã được thông báo/);
    assert.match(alerts[1].message, /Farm Operator cần kiểm tra/);
    const operatorAlert = alerts[1].notification_id;
    const app = express();
    app.use(express.json());
    app.use('/api/notifications', require('../src/routes/notification.routes'));
    app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const request = async (method, suffix, userId, body = {}) => {
      const token = jwt.sign({ sub: String(userId) }, require('../src/config/env').jwtSecret);
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/notifications${suffix}`, {
        method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const endpoint = `/${operatorAlert}/confirm-repair`;
    for (const id of [1,3]) assert.equal((await request('PATCH', endpoint, id)).status, 403);
    assert.equal((await request('PATCH', endpoint, 5)).status, 404);
    assert.equal((await request('PATCH', endpoint, 2)).status, 409);
    assert.equal((await request('PATCH', endpoint, 2, { repairNote: 42 })).status, 400);
    const listing = await request('GET', '', 2);
    assert.equal(listing.body.data[0].device_incident.can_confirm_repair, true);
    assert.equal((await request('GET', '', 3)).body.data[0].device_incident.can_confirm_repair, false);
    await db.exec(`UPDATE iot_sensor_latest SET is_valid=true,retained=true WHERE node_address=1 AND sensor_address=1`);
    assert.equal((await request('PATCH', endpoint, 2)).status, 409);
    await db.exec(`UPDATE iot_sensor_latest SET retained=false,last_received_at=now() WHERE node_address=1 AND sensor_address=1`);
    assert.deepEqual(await model.scan(), { created: 0 });
    // Telemetry recovery alone must not mark the repair complete.
    assert.equal((await db.query('SELECT status FROM device_incidents')).rows[0].status, 'OPEN');
    const repaired = await request('PATCH', endpoint, 2, { repairNote: 'Đã thay cảm biến' });
    assert.equal(repaired.status, 200);
    assert.equal(repaired.body.data.status, 'RESOLVED');
    assert.equal(repaired.body.data.resolved_by, 2);
    assert.equal((await request('PATCH', endpoint, 2)).status, 200);
    const confirmations = (await db.query("SELECT user_id FROM notifications WHERE title='Cảm biến đã được sửa xong' ORDER BY user_id")).rows;
    assert.deepEqual(confirmations, [{ user_id: 1 }, { user_id: 3 }]);
    assert.equal((await request('GET', '', 5)).body.data[0].device_incident.status, 'RESOLVED');
    assert.equal((await request('GET', '', 5)).body.data[0].device_incident.can_confirm_repair, false);
    await db.exec(`UPDATE iot_sensor_latest SET last_received_at=now()-interval '2 minutes' WHERE node_address=1 AND sensor_address=1;
      DELETE FROM iot_sensor_latest WHERE node_address=1 AND sensor_address=2;`);
    assert.deepEqual(await model.scan(), { created: 2 });
    assert.deepEqual((await db.query("SELECT reason FROM device_incidents WHERE status='OPEN' ORDER BY sensor_address")).rows,
      [{ reason: 'STALE' }, { reason: 'MISSING' }]);

    // The master is live but every sensor packet for node 1 is stale/missing.
    // Report one node incident, not three more sensor incidents.
    await db.exec(`UPDATE iot_sensor_latest SET last_received_at=now()-interval '2 minutes' WHERE node_address=1`);
    assert.deepEqual(await model.scan(), { created: 1 });
    const node = (await db.query("SELECT * FROM device_incidents WHERE device_type='NODE'")).rows[0];
    assert.equal(node.floor_id, 1);
    assert.equal(node.sensor_address, null);
    const nodeRecipients = (await db.query("SELECT user_id FROM notifications WHERE reference_id=$1 AND reference_type='DEVICE_INCIDENT' ORDER BY user_id", [node.incident_id])).rows;
    assert.deepEqual(nodeRecipients.map(n => n.user_id), [1,2,3,5]);
    const nodeAlert = (await db.query('SELECT notification_id FROM notifications WHERE reference_id=$1 AND user_id=2', [node.incident_id])).rows[0].notification_id;
    assert.equal((await request('PATCH', `/${nodeAlert}/confirm-repair`, 2)).status, 409);
    await db.exec(`UPDATE iot_sensor_latest SET last_received_at=now(),is_valid=false WHERE node_address=1 AND sensor_address=1`);
    // An explicit invalid sensor reading still proves the node communicates.
    assert.equal((await request('PATCH', `/${nodeAlert}/confirm-repair`, 2)).status, 200);
    assert.equal((await request('PATCH', `/${nodeAlert}/confirm-repair`, 2)).status, 200);
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM notifications WHERE title='Node đã được sửa xong'")).rows[0].n, 2);

    await db.exec(`UPDATE iot_masters SET reported_status='offline',status_received_at=now(),last_seen_at=now()`);
    assert.deepEqual(await model.scan(), { created: 1 });
    assert.deepEqual(await model.scan(), { created: 0 });
    const master = (await db.query("SELECT * FROM device_incidents WHERE device_type='MASTER'")).rows[0];
    assert.equal(master.floor_id, null);
    assert.equal(master.node_address, null);
    const masterAlerts = (await db.query("SELECT user_id,notification_id FROM notifications WHERE reference_id=$1 AND reference_type='DEVICE_INCIDENT' ORDER BY user_id", [master.incident_id])).rows;
    assert.deepEqual(masterAlerts.map(n => n.user_id), [1,2,3,4,5]);
    const masterEndpoint = `/${masterAlerts.find(n => n.user_id === 2).notification_id}/confirm-repair`;
    assert.equal((await request('PATCH', masterEndpoint, 2)).status, 409);
    // A retained online status cannot prove live recovery.
    await db.exec(`UPDATE iot_masters SET reported_status='online',status_retained=true,last_seen_at=now()-interval '2 minutes'`);
    assert.equal((await request('PATCH', masterEndpoint, 2)).status, 409);
    await db.exec(`UPDATE iot_masters SET reported_status='online',status_retained=false,last_seen_at=now()`);
    assert.equal((await request('PATCH', masterEndpoint, 2)).status, 200);
    assert.equal((await request('PATCH', masterEndpoint, 2)).status, 200);
    assert.deepEqual((await db.query("SELECT user_id FROM notifications WHERE title='Mạch master đã được sửa xong' ORDER BY user_id")).rows,
      [{ user_id: 1 }, { user_id: 3 }, { user_id: 4 }]);
    // Silence alone also reports master loss, even if its last status was online.
    await db.exec(`UPDATE iot_masters SET last_seen_at=now()-interval '2 minutes'`);
    assert.deepEqual(await model.scan(), { created: 1 });
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (previous) require.cache[dbPath] = previous; else delete require.cache[dbPath];
    await db.close();
  }
});

test('020 creates one shared table idempotently and rejects invalid device targets', async () => {
  const db = new PGlite();
  try {
    // Start without either incident table; the merged migration is repeatable.
    const schema = fs.readFileSync('database.sql', 'utf8');
    const upgrade = fs.readFileSync('migrations/020_device_incidents.sql', 'utf8');
    await db.exec(schema.slice(0, schema.indexOf('CREATE TABLE IF NOT EXISTS device_incidents')).replace(/BEGIN;\s*$/, ''));
    await db.exec(upgrade);
    await db.exec(upgrade);
    assert.equal((await db.query("SELECT to_regclass('sensor_incidents') AS legacy")).rows[0].legacy, null);
    await db.exec(`INSERT INTO roles(role_name) VALUES ('Admin');
      INSERT INTO users(role_id,email,password_hash,full_name) VALUES (1,'migration@test','x','Admin');
      INSERT INTO cultivation_rooms(room_code,room_name) VALUES ('R1','Room');
      INSERT INTO iot_masters(master_identifier,cultivation_room_id) VALUES ('m1',1);
      INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel)
        VALUES(1,1,'Floor',1,1,1);
      INSERT INTO device_incidents(floor_id,master_id,node_address,sensor_address,reason) VALUES (1,1,1,1,'INVALID');
      INSERT INTO notifications(user_id,notification_type,title,message,reference_type,reference_id)
        VALUES(1,'DEVICE_ISSUE','Fault','Fault','DEVICE_INCIDENT',1);`);
    await db.exec(upgrade);
    await db.exec(upgrade);
    assert.deepEqual((await db.query('SELECT incident_id,device_type,status FROM device_incidents')).rows,
      [{ incident_id: 1, device_type: 'SENSOR', status: 'OPEN' }]);
    assert.equal((await db.query('SELECT reference_type FROM notifications')).rows[0].reference_type, 'DEVICE_INCIDENT');
    for (const values of ["'MASTER',1,1,NULL,NULL", "'NODE',1,1,NULL,NULL", "'SENSOR',1,1,1,NULL", "'OTHER',NULL,1,NULL,NULL"]) {
      await assert.rejects(db.exec(`INSERT INTO device_incidents(device_type,floor_id,master_id,node_address,sensor_address,reason) VALUES (${values},'INVALID')`));
    }
  } finally { await db.close(); }
});
