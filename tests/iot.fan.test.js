const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { createRepository } = require('../src/models/autoMisting.model');
const { createService } = require('../src/services/autoMisting.service');

test('manual fans start unconfigured, can be mapped independently and reject channel collisions', async () => {
 const db = new PGlite();
 try {
  await db.exec(fs.readFileSync('database.sql','utf8'));
  await db.exec(fs.readFileSync('migrations/022_add_floor_fan_channel.sql','utf8'));
  await db.exec(`INSERT INTO cultivation_rooms(room_code,room_name) VALUES('FAN','Fan room');
   INSERT INTO iot_masters(master_identifier,cultivation_room_id,light_ssr_channel) VALUES('master01',1,3);
   INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel)
   VALUES(1,1,'Floor 1',1,1,1),(1,2,'Floor 2',1,2,2);`);
  const repo = createRepository(db);
  repo.lockFloor = (id,work)=>work();
  const service = createService(repo, {}, ()=>{ throw new Error('Fan mapping must not publish'); });
  assert.deepEqual((await service.list()).map(f=>f.fan_ssr_channel),[null,null]);
  for(const body of [null,{},[],{channel:'4'},{channel:0},{channel:9},{channel:1.5},{channel:4,extra:true}]) {
   await assert.rejects(service.configureFan(1,body),{statusCode:400});
  }
  await assert.rejects(service.configureFan(999,{channel:4}),{statusCode:404});
  assert.equal((await service.configureFan(1,{channel:4})).fan_ssr_channel,4);
  assert.equal((await service.configureFan(2,{channel:5})).fan_ssr_channel,5);
  for(const channel of [1,2,3,5]) {
   await assert.rejects(service.configureFan(1,{channel}),{statusCode:409});
  }
  await assert.rejects(db.exec('UPDATE cultivation_floors SET misting_ssr_channel=4 WHERE floor_id=2'),{constraint:'fan_mapping_conflict'});
  await assert.rejects(db.exec('UPDATE cultivation_floors SET misting_ssr_channel=4 WHERE floor_id=1'),{constraint:'fan_mapping_conflict'});
  await assert.rejects(db.exec('UPDATE iot_masters SET light_ssr_channel=4 WHERE id=1'),{constraint:'light_mapping_conflict'});
  assert.equal((await service.configureFan(1,{channel:null})).fan_ssr_channel,null);
  assert.equal((await service.configureFan(2,{channel:4})).fan_ssr_channel,4);
  assert.deepEqual((await service.list()).map(f=>f.misting_ssr_channel),[1,2]);
 } finally { await db.close(); }
});
