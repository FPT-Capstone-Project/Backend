const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createRepository } = require('../src/models/autoMisting.model');
const { createService } = require('../src/services/autoMisting.service');

test('floor tray generation preserves coordinates, repeats safely and rolls back conflicts', async () => {
  const db = new PGlite();
  const repo = createRepository(db);
  // Single isolated database session; production uses the existing floor advisory lock.
  repo.lockFloor = (id, work) => work();
  const service = createService(repo);
  try {
    await db.exec(fs.readFileSync('database.sql', 'utf8'));
    await db.exec(`
      INSERT INTO cultivation_rooms(room_code,room_name) VALUES('R1','Room one');
      INSERT INTO iot_masters(master_identifier,cultivation_room_id) VALUES('master01',1);
      INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel,total_rows,total_columns)
      VALUES(1,7,'Floor one',1,1,1,2,3);
    `);
    await assert.rejects(() => service.generateTrays('bad'), { statusCode: 400 });
    await assert.rejects(() => service.generateTrays(999), { statusCode: 404 });
    const first = await service.generateTrays(1);
    assert.equal(first.created_count, 6);
    assert.equal(first.total, 6);
    assert.equal(first.trays[0].tray_code, 'ROOM1-F7-R1-C1');
    assert.equal(first.trays[0].tray_name, 'Tray F7-R1-C1');
    assert.deepEqual(first.trays.map(t => [t.row_number, t.column_number]),
      [[1, 1], [1, 2], [1, 3], [2, 1], [2, 2], [2, 3]]);
    assert.ok(first.trays.every(t => t.floor_id === 1 && t.room_id === 1 && t.position_id && t.status === 'AVAILABLE'));
    const repeated = await service.generateTrays(1);
    assert.equal(repeated.created_count, 0);
    assert.deepEqual(repeated.trays, first.trays);
    await db.exec("UPDATE cultivation_trays SET status='OCCUPIED' WHERE tray_id=1");
    assert.equal((await service.generateTrays(1)).trays[0].status, 'OCCUPIED');
    await assert.rejects(() => service.deleteTrays(1), { statusCode: 409 });
    assert.equal((await repo.one('SELECT count(*)::int AS n FROM cultivation_trays')).n, 6);
    await db.exec("UPDATE cultivation_trays SET status='AVAILABLE' WHERE tray_id=1");
    await db.exec("UPDATE tray_positions SET status='MAINTENANCE' WHERE position_id=1");
    await assert.rejects(() => service.generateTrays(1), { statusCode: 409 });
    await db.exec("UPDATE tray_positions SET status='ACTIVE' WHERE position_id=1; UPDATE cultivation_floors SET total_columns=4 WHERE floor_id=1");
    // A globally conflicting code must roll back the newly inserted positions as well.
    await db.exec("INSERT INTO cultivation_trays(room_id,tray_code) VALUES(1,'ROOM1-F7-R2-C4')");
    await assert.rejects(() => service.generateTrays(1), { code: '23505' });
    assert.equal((await repo.one('SELECT count(*)::int AS n FROM tray_positions')).n, 6);
    await db.exec("DELETE FROM cultivation_trays WHERE tray_code='ROOM1-F7-R2-C4'");
    assert.equal((await service.generateTrays(1)).created_count, 2);
    await db.exec('UPDATE cultivation_floors SET total_rows=NULL WHERE floor_id=1');
    await assert.rejects(() => service.generateTrays(1), { statusCode: 400 });
    await assert.rejects(() => service.deleteTrays('bad'), { statusCode: 400 });
    await assert.rejects(() => service.deleteTrays(999), { statusCode: 404 });
    await db.exec(`CREATE TABLE test_tray_reference(tray_id INT REFERENCES cultivation_trays(tray_id));
      INSERT INTO test_tray_reference VALUES(1)`);
    await assert.rejects(() => service.deleteTrays(1), { statusCode: 409 });
    assert.equal((await repo.one('SELECT count(*)::int AS n FROM cultivation_trays')).n, 8);
    await db.exec(`DELETE FROM test_tray_reference;
      INSERT INTO cultivation_trays(room_id,tray_code) VALUES(1,'UNASSIGNED')`);
    assert.deepEqual(await service.deleteTrays(1), { floor_id: 1, deleted_count: 8 });
    assert.equal((await repo.one('SELECT count(*)::int AS n FROM tray_positions')).n, 8);
    assert.equal((await repo.one('SELECT tray_code FROM cultivation_trays')).tray_code, 'UNASSIGNED');
    assert.equal((await service.deleteTrays(1)).deleted_count, 0);
    await db.exec('UPDATE cultivation_floors SET total_rows=32767 WHERE floor_id=1');
    await assert.rejects(() => service.generateTrays(1), { statusCode: 400 });
  } finally {
    await db.close();
  }
});
