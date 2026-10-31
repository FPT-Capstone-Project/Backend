const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');

test('revised schema upgrade restores AUTO integrity without provisioning hardware or starting runs',async()=>{
 const db=new PGlite();
 try {
  // Reproduce the supplied table-only schema before the repair section.
  const schema=fs.readFileSync('database.sql','utf8').split('-- ---------- AUTO CONTROL INTEGRITY ----------')[0];
  await db.exec(schema+'COMMIT;');
  await db.exec(`INSERT INTO roles(role_name) VALUES('Admin'),('Farm Operator'),('Customer');
   INSERT INTO cultivation_rooms(room_code,room_name) VALUES('R1','Room one'),('R2','Room two');
   INSERT INTO iot_masters(master_identifier,cultivation_room_id) VALUES('existing-device',1);
   INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel)
    VALUES(1,1,'Floor one',1,1,1);
   INSERT INTO iot_ssr_states(master_id,channel,reported_state) VALUES(1,1,'OFF');`);
  const migration=fs.readFileSync('migrations/012_restore_auto_control_integrity.sql','utf8');
  await db.exec(migration);await db.exec(migration);
  assert.equal((await db.query('SELECT * FROM role_permissions')).rows.length,2);
  assert.deepEqual((await db.query('SELECT master_identifier FROM iot_masters')).rows,[{master_identifier:'existing-device'}]);
  assert.equal((await db.query('SELECT * FROM iot_auto_control_runs')).rows.length,0);
  await db.exec(`INSERT INTO iot_ssr_states(master_id,channel,desired_state) VALUES(1,1,'ON')
   ON CONFLICT(master_id,channel) DO UPDATE SET desired_state=EXCLUDED.desired_state`);
  const ssr=(await db.query('SELECT * FROM iot_ssr_states')).rows;
  assert.equal(ssr.length,1);assert.equal(ssr[0].reported_state,'OFF');assert.equal(ssr[0].desired_state,'ON');
  for(const values of ["(1,2,'Duplicate channel',1,2,1)","(1,2,'Duplicate node',1,1,2)","(1,1,'Duplicate floor',1,2,2)"]) {
   await assert.rejects(db.exec(`INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel) VALUES${values}`),{code:'23505'});
  }
  await assert.rejects(db.exec('UPDATE iot_masters SET cultivation_room_id=2 WHERE id=1'),{code:'23514'});
  await assert.rejects(db.exec('UPDATE cultivation_floors SET room_id=2 WHERE floor_id=1'),{code:'23514'});
  await assert.rejects(db.exec('UPDATE iot_masters SET light_ssr_channel=1 WHERE id=1'),{constraint:'light_mapping_conflict'});
  await db.exec('UPDATE iot_masters SET light_ssr_channel=8 WHERE id=1');
  await assert.rejects(db.exec('UPDATE cultivation_floors SET misting_ssr_channel=8 WHERE floor_id=1'),{constraint:'light_mapping_conflict'});
  await db.exec('DROP INDEX uq_iot_ssr_master_channel; INSERT INTO iot_ssr_states(master_id,channel) VALUES(1,1)');
  await assert.rejects(db.exec(migration),{code:'23505'});
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT * FROM iot_ssr_states')).rows.length,2,'conflicting device states must not be silently deleted');
 } finally {await db.close();}
});
