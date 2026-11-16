const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createRepository}=require('../src/models/autoMisting.model');
const {createService}=require('../src/services/autoMisting.service');
const config={mushroom_type_id:1,humidity_min:85,humidity_max:95,humidity_start_threshold:83,humidity_stop_threshold:87,
 misting_pulse_ms:5000,cooldown_ms:60000,evaluation_interval_ms:5000,sensor_max_age_ms:20000,required_valid_sensors:3,
 max_sensor_spread_percent:10,max_activations_per_hour:20,max_cumulative_on_ms_per_hour:100000,
 fan_enabled:true,fan_run_minutes:1,fan_rest_minutes:2};
test('fan shares existing AUTO configuration, run, runtime, log and stop; migration is repeatable',async()=>{
 const db=new PGlite();let clock=Date.now();const commands=[];
 try {
  await db.exec(fs.readFileSync('database.sql','utf8'));
  await db.exec(fs.readFileSync('migrations/030_add_fan_auto_control.sql','utf8'));
  await db.exec(`INSERT INTO cultivation_rooms(room_code,room_name) VALUES('FAN','Fan room');
   INSERT INTO mushroom_types(name,growing_days,price) VALUES('Test',30,1);
   INSERT INTO iot_masters(master_identifier,cultivation_room_id) VALUES('master01',1);
   INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel,fan_ssr_channel)
   VALUES(1,1,'Floor 1',1,1,1,4);`);
  const repo=createRepository(db);
  repo.lockFloor=async(id,work)=>work();repo.lockChannel=async(id,ch,work)=>work();
  repo.workerReady=async()=>true;repo.profiles=async()=>({profiles:[],requiresApproval:false});
  repo.sensors=async()=>[1,2,3].map(sensor_address=>({sensor_address,humidity:80,temperature:25,is_valid:true,retained:false,last_received_at:new Date(clock)}));
  const service=createService(repo,{isReady:()=>true},async(...args)=>commands.push(args),()=>clock);
  for(const bad of [0,1441,1.5,'2'])await assert.rejects(service.save(1,{...config,fan_run_minutes:bad},null),{statusCode:400});
  await service.save(1,config,null);
  await service.start(1,{dryRun:true},null);
  assert.equal((await repo.rows('SELECT * FROM iot_auto_control_runs')).length,1);
  for(let i=0;i<3;i++)await service.fan.evaluate(1);
  assert.equal((await service.status(1)).fan.state,'RUNNING');
  await assert.rejects(service.save(1,config,null),{statusCode:409});
  await assert.rejects(service.manual(1,4,'ON',null),{statusCode:409});
  await assert.rejects(db.exec('UPDATE cultivation_floors SET fan_ssr_channel=5 WHERE floor_id=1'),{constraint:'fan_mapping_conflict'});
  clock+=60000;await service.fan.evaluate(1);
  assert.equal((await service.status(1)).fan.state,'RESTING');
  await service.evaluate(1);
  await service.stop(1,null);
  assert.equal((await repo.run(1)).status,'STOPPED');
  assert.equal((await service.status(1)).fan.state,'STOPPED');
  assert.equal((await repo.runtime(1)).control_state,'DISABLED');
  clock+=3600000;await service.fan.evaluate(1);
  assert.equal((await service.status(1)).fan.state,'STOPPED');
  assert.equal(commands.length,0);
  assert.ok((await repo.rows("SELECT * FROM iot_auto_control_logs WHERE event_type LIKE 'FAN_%' AND run_id IS NOT NULL")).length>0);
  assert.equal((await repo.one("SELECT to_regclass('iot_fan_auto_control') AS table_name")).table_name,null);
  assert.equal((await repo.one("SELECT to_regclass('iot_fan_auto_logs') AS table_name")).table_name,null);
  await db.exec('UPDATE cultivation_floors SET fan_ssr_channel=NULL WHERE floor_id=1');
  await assert.rejects(service.start(1,{dryRun:true},null),{statusCode:409});
  await service.save(1,{...config,fan_enabled:false},null);await service.start(1,{dryRun:true},null);
  assert.equal((await service.status(1)).fan.state,'STOPPED');await service.stop(1,null);
  await db.exec('UPDATE cultivation_floors SET fan_ssr_channel=4 WHERE floor_id=1');
  await service.save(1,config,null);await service.start(1,{dryRun:true},null);
  for(let i=0;i<3;i++)await service.fan.evaluate(1);
  const readOne=repo.one;repo.one=(sql,args)=>sql.includes('JOIN role_permissions')?Promise.resolve({allowed:true}):readOne(sql,args);
  await service.manual(1,4,'OFF',null);
  assert.equal((await repo.run(1)).status,'STOPPED');
  assert.equal((await repo.runtime(1)).fan_state,'OFF_PENDING');
  await assert.rejects(service.start(1,{dryRun:true},null),{statusCode:409});
  await service.fan.recover();assert.equal((await service.status(1)).fan.state,'STOPPED');
  const runsBefore=(await repo.rows('SELECT * FROM iot_auto_control_runs')).length;
  await assert.rejects(service.start(1,{dryRun:false},null));
  assert.equal((await repo.rows('SELECT * FROM iot_auto_control_runs')).length,runsBefore);
  // Legacy tables are archived and removed only when stopped.
  await db.exec(`CREATE TABLE iot_fan_auto_control(floor_id integer,run_minutes integer,rest_minutes integer,enabled boolean,state text);
   INSERT INTO iot_fan_auto_control VALUES(1,3,7,true,'RUNNING');
   CREATE TABLE iot_fan_auto_logs(floor_id integer,event_type text,details jsonb,created_at timestamptz);
   INSERT INTO iot_fan_auto_logs VALUES(1,'STARTED','{}',now());`);
  const migration=fs.readFileSync('migrations/030_add_fan_auto_control.sql','utf8');
  await assert.rejects(db.exec(migration));await db.exec('ROLLBACK');
  await db.exec("UPDATE iot_fan_auto_control SET enabled=false,state='STOPPED'");
  await db.exec(migration);await db.exec(migration);
  assert.equal((await repo.config(1)).fan_run_minutes,3);
  assert.equal((await repo.rows("SELECT * FROM iot_auto_control_logs WHERE event_type LIKE 'FAN_LEGACY_%'")).length,2);
  assert.equal((await repo.one("SELECT to_regclass('iot_fan_auto_control') AS name")).name,null);

 } finally {await db.close();}
});
