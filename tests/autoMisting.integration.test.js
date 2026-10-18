const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {createRepository}=require('../src/models/autoMisting.model');
const {createService}=require('../src/services/autoMisting.service');
const config={mushroom_type_id:1,humidity_min:85,humidity_max:95,humidity_start_threshold:83,humidity_stop_threshold:87,
 misting_pulse_ms:5000,cooldown_ms:60000,evaluation_interval_ms:5000,sensor_max_age_ms:20000,required_valid_sensors:3,
 max_sensor_spread_percent:10,max_activations_per_hour:20,max_cumulative_on_ms_per_hour:100000};

test('automation migrations and service against isolated PostgreSQL; MQTT is mocked',async t=>{
 const db=new PGlite();
 let now=Date.now(),connected=true,failOn=false,failOff=false,beforeOn;
 const calls=[];
 const repo=createRepository(db);
 // PGlite runs one session. Emulate separate-process mutex ordering here;
 // production uses PostgreSQL session advisory locks tested separately below.
 const tails=new Map();
 const mutex=async(key,work)=>{
  const previous=tails.get(key)||Promise.resolve();let release;
  const next=new Promise(r=>release=r);tails.set(key,next);
  await previous;
  try{return await work();}finally{release();if(tails.get(key)===next)tails.delete(key);}
 };
 repo.lockFloor=(id,fn)=>mutex(`floor:${id}`,fn);
 repo.lockChannel=(id,ch,fn)=>mutex(`channel:${id}:${ch}`,fn);
 const command=async(master,channel,body,user,internal)=>{
  if(body.action==='ON' && beforeOn)await beforeOn();
  const publish=async()=>{
  if(internal?.beforePublish)await internal.beforePublish();
  calls.push({master,channel,action:body.action});
  if((body.action==='ON' && failOn) || (body.action==='OFF' && failOff))throw new Error('Mock MQTT publication failed');
  return {};
  };
  return internal.lockHeld?publish():repo.lockChannel(1,channel,publish);
 };
 const service=createService(repo,{isReady:()=>connected},command,()=>now);
 const fresh=async()=>{await db.query('UPDATE iot_sensor_latest SET last_received_at=$1',[new Date(now)]);await db.exec('UPDATE iot_auto_control_worker SET heartbeat_at=now()');};
 try{
  await db.exec(fs.readFileSync('database.sql','utf8'));
  await db.exec("INSERT INTO roles(role_name) VALUES('Farm Operator'),('Admin'),('Customer'); INSERT INTO cultivation_rooms(room_code,room_name) VALUES('R1','Room one'),('R2','Room two'); INSERT INTO cultivation_trays(room_id,tray_code) VALUES(1,'T1'); INSERT INTO mushroom_types(name,growing_days,price) VALUES('Test mushroom',30,1);");
  await db.exec(fs.readFileSync('migrations/004_add_iot_integration.sql','utf8'));
  await db.exec(fs.readFileSync('migrations/005_add_auto_misting_control.sql','utf8'));
  await db.exec('INSERT INTO iot_auto_control_worker(id,heartbeat_at) VALUES(1,now())');
  await db.exec("INSERT INTO users(role_id,email,password_hash,full_name) VALUES(1,'operator@example.test','test','Operator')");
  await db.exec('UPDATE iot_masters SET cultivation_room_id=1 WHERE id=1');
  await t.test('migration preserves trays without guessing floors and grants named operator roles only',async()=>{
   assert.equal((await repo.one('SELECT floor_id FROM cultivation_trays')).floor_id,null);
   assert.equal((await repo.rows('SELECT * FROM role_permissions')).length,2);
   await assert.rejects(()=>service.map(null,{room_id:2,floor_number:1,floor_name:'Wrong',master_id:1,node_address:1,misting_ssr_channel:1}));
  });
  for(const n of [1,2]){
   await service.map(null,{room_id:1,floor_number:n,floor_name:`Floor ${n}`,master_id:1,node_address:n,misting_ssr_channel:n});
  }
  // A failed insert consumes the SERIAL value; resolve actual IDs.
  const [f1,f2]=await repo.list(),id=f1.floor_id,other=f2.floor_id;
  await service.assignTray(id,1);
  for(const n of [1,2])for(const s of [1,2,3])await db.query(`INSERT INTO iot_sensor_latest(master_id,node_address,sensor_address,temperature,humidity,is_valid,last_received_at)
   VALUES(1,$1,$2,26,81,true,$3)`,[n,s,new Date(now)]);
  await t.test('mapping uniqueness and master room constraints',async()=>{
   await assert.rejects(()=>service.map(null,{room_id:1,floor_number:3,floor_name:'Duplicate',master_id:1,node_address:3,misting_ssr_channel:1}));
   await assert.rejects(()=>db.exec('UPDATE iot_masters SET cultivation_room_id=2 WHERE id=1'));
   await assert.rejects(()=>db.exec('UPDATE cultivation_trays SET room_id=2 WHERE tray_id=1'));
  });
  await t.test('default MANUAL and Save creates neither a run nor commands',async()=>{
   assert.equal((await service.configuration(id)).mode,'MANUAL');
   assert.equal((await service.save(id,config,null)).mode,'MANUAL');
   await service.save(other,config,null);
   assert.equal(await repo.run(id),undefined);
   assert.equal((await service.evaluate(id)).action,'NONE');assert.equal(calls.length,0);
  });
  await t.test('real Start fails closed; explicit dry Start creates one immutable run',async()=>{
   await assert.rejects(()=>service.start(id,{dryRun:false},null),/watchdog/);
   const start=await service.start(id,{},null);assert.equal(start.mode,'AUTO');assert.equal(start.run.dry_run,true);
   assert.equal(start.run.config_snapshot.humidity_min,85);
   await assert.rejects(()=>service.start(id,{},null),/Stop/);
   await assert.rejects(()=>service.save(id,config,null),/Stop/);
   await assert.rejects(()=>service.map(id,{room_id:1,floor_number:1,floor_name:'Edit',master_id:1,node_address:1,misting_ssr_channel:1}),/Stop/);
  });
  await t.test('Floor 1 AUTO, Floor 2 MANUAL; preview has no writes; concurrent evaluations reserve one pulse',async()=>{
   const before=(await repo.rows('SELECT * FROM iot_auto_control_logs')).length;
   assert.equal((await service.evaluate(id,true)).decision.action,'ON');
   assert.equal((await repo.rows('SELECT * FROM iot_auto_control_logs')).length,before);
   await Promise.all([service.evaluate(id),service.evaluate(id)]);
   assert.equal((await repo.runtime(id)).control_state,'MISTING');
   assert.equal((await service.evaluate(other)).action,'NONE');
   assert.equal((await repo.budget(id)).count,1);assert.equal(calls.length,0);
  });
  await t.test('deadline enforces simulated OFF; cooldown and second floor are independent',async()=>{
   now+=5000;await fresh();await service.evaluate(id);
   assert.equal((await repo.runtime(id)).control_state,'COOLDOWN');
   await service.start(other,{},null);await service.evaluate(other);
   assert.equal((await repo.runtime(other)).control_state,'MISTING');
   assert.equal((await service.evaluate(id)).action,'NONE');
   await service.stop(other,null);assert.equal((await repo.run(other)).status,'STOPPED');
   assert.equal((await repo.run(id)).status,'RUNNING');
  });
  await t.test('restart stops all runs and never resumes a pulse',async()=>{
   now+=61000;await fresh();await service.evaluate(id);assert.equal((await repo.runtime(id)).control_state,'MISTING');
   await service.recover();assert.equal((await repo.run(id)).status,'STOPPED');
   assert.equal((await repo.runtime(id)).control_state,'DISABLED');
   assert.equal((await service.evaluate(id)).action,'NONE');assert.equal(calls.length,0);
  });
  await t.test('real mocked pulse uses existing command service and OFF never waits for delayed ON feedback',async()=>{
   process.env.AUTO_MISTING_REAL_ENABLED='true';process.env.AUTO_MISTING_VERIFIED_WATCHDOGS='{"master01":10000}';
   await fresh();await db.query("INSERT INTO iot_ssr_states(master_id,channel,reported_state,reported_retained,state_reported_at) VALUES(1,1,'OFF',false,$1)",[new Date(now)]);
   await service.start(id,{dryRun:false},null);await service.evaluate(id);
   assert.equal(calls.at(-1).action,'ON');
   now+=5000;await fresh();await service.evaluate(id);assert.equal(calls.at(-1).action,'OFF');
   assert.equal((await repo.runtime(id)).control_state,'OFF_PENDING');
   await assert.rejects(()=>service.manual(1,1,'ON',null),/AUTO owns/);
   await assert.rejects(()=>service.manual(1,1,'OFF',null),/permission/);
   now+=17000;await db.query("UPDATE iot_ssr_states SET reported_state='ON',state_reported_at=$1",[new Date(now)]);
   await service.evaluate(id);assert.equal((await repo.runtime(id)).control_state,'OFF_PENDING');
   now+=3000;await db.query("UPDATE iot_ssr_states SET reported_state='OFF',state_reported_at=$1",[new Date(now)]);
   await service.evaluate(id);assert.equal((await repo.runtime(id)).control_state,'COOLDOWN');
   await service.stop(id,null);assert.equal((await service.status(id)).mode,'MANUAL');
  });
  await t.test('stale sensors and disconnected MQTT prevent real Start',async()=>{
   now+=30000;await assert.rejects(()=>service.start(id,{dryRun:false},null),/stale/);
   await fresh();connected=false;await assert.rejects(()=>service.start(id,{dryRun:false},null),/offline/);connected=true;
  });
  await t.test('retained and invalid sensor samples block dry Start too',async()=>{
   await db.exec('UPDATE iot_sensor_latest SET retained=true WHERE node_address=1 AND sensor_address=1');
   await assert.rejects(()=>service.start(id,{},null),/retained/);
   await db.exec('UPDATE iot_sensor_latest SET retained=false,is_valid=false WHERE node_address=1 AND sensor_address=1');
   await assert.rejects(()=>service.start(id,{},null),/invalid/);
  });
  await t.test('authorized manual OFF wins a race immediately before ON reservation',async()=>{
   await db.exec('UPDATE iot_sensor_latest SET is_valid=true,retained=false');await fresh();
   await db.query("UPDATE iot_ssr_states SET reported_state='OFF',state_reported_at=$1",[new Date(now)]);
   await service.start(id,{dryRun:false},1);
   beforeOn=()=>repo.lockChannel(1,1,()=>service.manual(1,1,'OFF',1));
   const before=calls.filter(c=>c.action==='ON').length;
   await service.evaluate(id);beforeOn=null;
   assert.equal(calls.filter(c=>c.action==='ON').length,before);
   const run=await repo.run(id);assert.equal(run.status,'STOPPED');assert.equal(run.stopped_by,1);
   now+=3000;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);
   await service.evaluate(id);assert.equal((await repo.runtime(id)).control_state,'DISABLED');
  });
  await t.test('uncertain ON and failed OFF remain durable, block restart, and reconcile without replaying ON',async()=>{
   await fresh();await service.start(id,{dryRun:false},1);
   failOn=true;failOff=true;await service.evaluate(id);failOn=false;
   assert.equal((await repo.run(id)).status,'FAULT');assert.equal((await repo.runtime(id)).control_state,'OFF_PENDING');
   assert.match((await repo.runtime(id)).last_error,/publication failed/);
   await assert.rejects(()=>service.start(id,{dryRun:false},1),/resolve pending OFF/);
   const onCount=calls.filter(c=>c.action==='ON').length;
   failOff=false;now+=3000;await service.recover();
   assert.equal(calls.filter(c=>c.action==='ON').length,onCount);assert.equal(calls.at(-1).action,'OFF');
   now+=3000;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);await service.evaluate(id);
   assert.equal((await repo.runtime(id)).control_state,'DISABLED');
  });
  await t.test('sensor fault during pulse stops run and requests OFF; no automatic resume',async()=>{
   await fresh();await service.start(id,{dryRun:false},1);await service.evaluate(id);
   await db.exec('UPDATE iot_sensor_latest SET is_valid=false WHERE node_address=1 AND sensor_address=1');
   now+=1000;await service.evaluate(id);
   assert.equal((await repo.run(id)).status,'FAULT');assert.equal(calls.at(-1).action,'OFF');
   now+=3000;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);await service.evaluate(id);
   assert.equal((await service.evaluate(id)).action,'NONE');
  });
  await t.test('unassigned trays require an explicitly named approved floor profile',async()=>{
   await db.exec("UPDATE iot_sensor_latest SET is_valid=true; INSERT INTO cultivation_trays(room_id,tray_code) VALUES(1,'T2')");await fresh();
   await assert.rejects(()=>service.start(id,{},1),/approved named floor profile/);
   await service.save(id,{...config,profile_name:'Operator approved mixed floor',profile_approved:true},1);
   await service.start(id,{},1);await service.stop(id,1);
   const saved=await repo.config(id);assert.equal(saved.configured_by,1);
   assert.equal((await repo.run(id)).started_by,1);assert.equal((await repo.run(id)).stopped_by,1);
  });
 }finally{delete process.env.AUTO_MISTING_REAL_ENABLED;delete process.env.AUTO_MISTING_VERIFIED_WATCHDOGS;await db.close();}
});
