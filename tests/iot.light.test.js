const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createIotService } = require('../src/services/iot.service');

test('light configuration validates input and translates mapping conflicts', async () => {
  let room = 1, exists = true, conflict = false;
  const writes = [];
  const service = createIotService({
    findMaster: async () => exists ? { id: 1, cultivationRoomId: room } : null,
    setLightChannel: async (id, channel) => {
      if (conflict) throw Object.assign(new Error('Channel conflict'), { constraint: 'light_mapping_conflict' });
      writes.push(channel); return { id, light_ssr_channel: channel };
    },
  }, {});
  for (const body of [undefined, {}, [], {channel: '3'}, {channel: 0}, {channel: 9}, {channel: 1.5}, {channel: 3, extra: true}]) {
    await assert.rejects(service.configureLight('master01', body), {statusCode: 400});
  }
  assert.equal((await service.configureLight('master01', {channel: 3})).light_ssr_channel, 3);
  assert.equal((await service.configureLight('master01', {channel: null})).light_ssr_channel, null);
  room = null;
  await assert.rejects(service.configureLight('master01', {channel: 3}), {statusCode: 409});
  room = 1; conflict = true;
  await assert.rejects(service.configureLight('master01', {channel: 3}), {statusCode: 409});
  exists = false;
  await assert.rejects(service.configureLight('master01', {channel: 3}), {statusCode: 404});
  assert.deepEqual(writes, [3, null]);
});

test('migration preserves existing masters and prevents valve/light collisions in both directions', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE iot_masters(id INT PRIMARY KEY, cultivation_room_id INT);
      CREATE TABLE cultivation_floors(floor_id INT PRIMARY KEY, master_id INT REFERENCES iot_masters(id), misting_ssr_channel INT);
      INSERT INTO iot_masters VALUES(1,1),(2,2),(3,NULL);
      INSERT INTO cultivation_floors VALUES(1,1,1);`);
    await db.exec(fs.readFileSync('migrations/009_add_master_light_channel.sql', 'utf8'));
    assert.equal((await db.query('SELECT light_ssr_channel FROM iot_masters WHERE id=1')).rows[0].light_ssr_channel, null);
    await db.exec('UPDATE iot_masters SET light_ssr_channel=3 WHERE id=1');
    await assert.rejects(db.exec('UPDATE iot_masters SET light_ssr_channel=1 WHERE id=1'), {constraint: 'light_mapping_conflict'});
    await assert.rejects(db.exec('INSERT INTO cultivation_floors VALUES(2,1,3)'), {constraint: 'light_mapping_conflict'});
    await assert.rejects(db.exec('UPDATE cultivation_floors SET misting_ssr_channel=3 WHERE floor_id=1'), {constraint: 'light_mapping_conflict'});
    await assert.rejects(db.exec('UPDATE iot_masters SET light_ssr_channel=9 WHERE id=1'));
    await assert.rejects(db.exec('UPDATE iot_masters SET light_ssr_channel=3 WHERE id=3'), {constraint: 'light_mapping_conflict'});
    await db.exec('INSERT INTO cultivation_floors VALUES(2,2,3)');
    await db.exec('UPDATE iot_masters SET light_ssr_channel=NULL WHERE id=1');
    await db.exec('UPDATE cultivation_floors SET misting_ssr_channel=3 WHERE floor_id=1');
  } finally { await db.close(); }
});
