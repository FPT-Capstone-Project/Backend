const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {EventEmitter}=require('node:events');
const {PGlite}=require('@electric-sql/pglite');
const {createRepository}=require('../src/models/autoMisting.model');
const {createService}=require('../src/services/autoMisting.service');
const {createWorker}=require('../src/services/autoMisting.worker');
const {suggest}=require('../src/services/autoMisting.profile');

const config={mushroom_type_id:1,humidity_min:85,humidity_max:95,humidity_start_threshold:83,humidity_stop_threshold:87,
 misting_pulse_ms:5000,cooldown_ms:60000,evaluation_interval_ms:5000,sensor_max_age_ms:20000,required_valid_sensors:3,
 max_sensor_spread_percent:10,max_activations_per_hour:20,max_cumulative_on_ms_per_hour:100000};

test('AUTO recovery uses isolated PostgreSQL and mocked device feedback',async t=>{
 const previousEnabled=process.env.AUTO_MISTING_REAL_ENABLED,previousWatchdogs=process.env.AUTO_MISTING_VERIFIED_WATCHDOGS;
 process.env.AUTO_MISTING_REAL_ENABLED='true';process.env.AUTO_MISTING_VERIFIED_WATCHDOGS='{"master01":10000}';
 const db=new PGlite(),repo=createRepository(db);
 // As in the main integration suite, emulate independent session locks because
 // PGlite has one connection. Exercise races by stopping before channel acquire.
 repo.lockFloor=async(id,work)=>work();repo.lockChannel=async(id,channel,work)=>work();
 let now=Date.now(),online=true,guard=true,beforeOn,afterReserve;
 const calls=[];
 const feedback=async(patch={})=>{
  await db.query(`UPDATE iot_ssr_states SET reported_state='OFF',desired_state=$1,
   reported_retained=$2,state_reported_at=$3 WHERE master_id=1 AND channel=1`,
  [patch.desired || 'OFF',patch.retained || false,new Date(patch.at??now)]);
 };
 const fresh=async()=>db.query('UPDATE iot_sensor_latest SET last_received_at=$1',[new Date(now)]);
 const command=async(master,channel,body,user,internal)=>{
  if(body.action==='ON' && beforeOn)await beforeOn();
  await internal.beforePublish?.();
  if(body.action==='ON' && afterReserve)await afterReserve();
  internal.authorizePublish?.();
  calls.push(body.action);
  if(!online)throw Object.assign(new Error('MQTT unavailable'),{statusCode:503});
  // Only explicit Start/OFF refresh automatically gets mocked feedback. Recovery
  // OFF waits for the test to deliver an independent device acknowledgement.
  if(body.action==='OFF' && internal.beforePublish){now++;await feedback();}
  return {};
 };
 const service=createService(repo,{isReady:()=>online},command,()=>now,async ms=>{now+=ms;});
 const evaluate=()=>service.evaluate(1,false,()=>guard);
 const start=async()=>{await fresh();return (await service.start(1,{dryRun:false},1)).run;};
 const reset=async()=>{
  now=Date.now();online=true;guard=true;beforeOn=null;afterReserve=null;calls.length=0;
  process.env.AUTO_MISTING_VERIFIED_WATCHDOGS='{"master01":10000}';
  await db.exec(`DELETE FROM iot_auto_control_logs; DELETE FROM iot_auto_control_runtime;
   DELETE FROM iot_auto_control_runs; UPDATE cultivation_floors SET status='ACTIVE';
   UPDATE iot_auto_control_worker SET heartbeat_at=now();
   UPDATE iot_sensor_latest SET is_valid=true; UPDATE iot_masters SET reported_status='online';`);
  await fresh();await feedback();await service.save(1,config,1);
 };
 try {
  await db.exec(fs.readFileSync('database.sql','utf8'));
  await db.exec(`INSERT INTO roles(role_name) VALUES('Farm Operator');
   INSERT INTO users(role_id,email,password_hash,full_name) VALUES(1,'recovery@example.test','test','Operator');
   INSERT INTO role_permissions(role_id,permission_id)
    SELECT 1,permission_id FROM permissions WHERE permission_name='iot.automation.manage';
   INSERT INTO cultivation_rooms(room_code,room_name) VALUES('R1','Recovery room');
   INSERT INTO mushroom_types(name,growing_days,price) VALUES('Test mushroom',30,1);
   INSERT INTO iot_masters(master_identifier,cultivation_room_id,reported_status) VALUES('master01',1,'online');
   INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel)
    VALUES(1,1,'Recovery floor',1,1,1);
   INSERT INTO iot_auto_control_worker(id,heartbeat_at) VALUES(1,now());
   INSERT INTO iot_ssr_states(master_id,channel,reported_state,reported_retained,state_reported_at)
    VALUES(1,1,'OFF',false,now());`);
  for(const sensor of [1,2,3])await db.query(`INSERT INTO iot_sensor_latest
   (master_id,node_address,sensor_address,temperature,humidity,is_valid,last_received_at)
   VALUES(1,1,$1,26,81,true,$2)`,[sensor,new Date(now)]);
  await service.save(1,config,1);

  for(const active of [false,true])await t.test(`restart from ${active?'MISTING':'IDLE'} ends the run and requires explicit Start`,async()=>{
   await reset();const run=await start();
   if(active)await evaluate();
   const budget=await repo.budget(1),oldCycle=(await repo.runtime(1)).cycle_id;
   now+=300000;await fresh();const first=calls.length;
   await service.recover();
   assert.deepEqual(calls.slice(first),['OFF']);
   assert.equal((await service.status(1)).mode,'MANUAL');
   assert.equal((await repo.run(1)).status,'FAULT');
   await assert.rejects(()=>start(),/hoàn tất xác nhận tắt/);
   assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
   assert.equal((await repo.runtime(1)).cycle_id,null);
   assert.equal((await repo.runtime(1)).pulse_deadline_at,null);
   assert.deepEqual(await repo.budget(1),budget);
   await evaluate(); // Old live OFF predates recovery.
   assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
   now++;await feedback({retained:true});await evaluate();
   assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
   await feedback({at:now+10000});await evaluate();
   assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
   await feedback({desired:'ON'});await evaluate();
   assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
   await feedback();now+=20001;await evaluate(); // Acknowledgement is now stale.
   assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
   now++;await feedback();await evaluate();
   assert.equal((await repo.runtime(1)).control_state,'DISABLED');
   await fresh();await evaluate();
   assert.ok(calls.slice(first).every(action=>action==='OFF'));
   now+=60001;await fresh();await evaluate();
   assert.ok(calls.slice(first).every(action=>action==='OFF'));
   assert.equal((await repo.run(1)).id,run.id);
   const restarted=await start();assert.notEqual(restarted.id,run.id);
   await evaluate();assert.equal(calls.at(-1),'ON');
   assert.notEqual((await repo.runtime(1)).cycle_id,oldCycle);
  });

  await t.test('offline recovery ends AUTO and reconnection cannot reactivate it',async()=>{
   await reset();const run=await start();online=false;now+=30000;
   await service.recover();await evaluate();
   assert.equal((await repo.run(1)).status,'FAULT');
   assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
   assert.match((await repo.runtime(1)).last_error,/MQTT unavailable/);
   online=true;now+=3000;await evaluate();now++;await feedback();await evaluate();
   now+=60001;await evaluate();
   assert.equal((await repo.runtime(1)).control_state,'DISABLED');
   await fresh();online=false;now+=5001;await evaluate();
   assert.equal((await repo.runtime(1)).control_state,'DISABLED');
   assert.ok(calls.every(action=>action==='OFF'));
   online=true;now+=5001;await fresh();await evaluate();
   assert.ok(calls.every(action=>action==='OFF'));assert.equal((await repo.run(1)).id,run.id);
  });

  for(const stage of ['preparation','publication'])await t.test(`leadership lost during ON ${stage} ends AUTO and cancels ON`,async()=>{
   await reset();await start();
   if(stage==='preparation')beforeOn=async()=>{guard=false;};
   else afterReserve=async()=>{guard=false;};
   await evaluate();
   assert.ok(calls.every(action=>action==='OFF'));
   assert.equal((await repo.run(1)).status,'FAULT');
   assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
   guard=true;beforeOn=null;afterReserve=null;
   await service.recover();now++;await feedback();await evaluate();
   now+=60001;await fresh();await evaluate();assert.ok(calls.every(action=>action==='OFF'));
  });

  await t.test('operator Stop, manual OFF and FAULT are never reactivated by recovery',async()=>{
   for(const finish of ['stop','manual','fault']) {
    await reset();await start();await evaluate();
    if(finish==='stop')await service.stop(1,1);
    else if(finish==='manual')await service.manual(1,1,'OFF',1);
    else {process.env.AUTO_MISTING_VERIFIED_WATCHDOGS='{}';now+=1000;await evaluate();}
    const ended=await repo.run(1),before=calls.length;
    await service.recover();now++;await feedback();await evaluate();
    assert.equal((await repo.runtime(1)).control_state,'DISABLED');
    assert.deepEqual(await repo.run(1),ended);
    now+=60001;await fresh();await service.recover();await evaluate();
    assert.ok(calls.slice(before).every(action=>action==='OFF'));
   }
  });

  await t.test('Stop racing with recovery wins after candidate selection',async()=>{
   await reset();await start();
   const original=repo.candidates;
   repo.candidates=async()=>{const candidates=await original();await service.stop(1,1);return candidates;};
   try {await service.recover();}finally{repo.candidates=original;}
   assert.equal((await repo.run(1)).status,'STOPPED');
   assert.equal((await repo.runtime(1)).control_state,'DISABLED');
  });

  await t.test('changed mapping and revoked watchdog block resumed ON',async()=>{
   for(const change of ['mapping','watchdog']) {
    await reset();await start();await service.recover();now++;await feedback();await evaluate();
    if(change==='mapping')await db.exec("UPDATE cultivation_floors SET status='INACTIVE'");
    else process.env.AUTO_MISTING_VERIFIED_WATCHDOGS='{}';
    now+=60001;await fresh();await evaluate();
    assert.equal((await repo.run(1)).status,'FAULT');
    assert.ok(calls.every(action=>action==='OFF'));
   }
  });

  await t.test('recovery keeps hourly reservations and cannot reset an exhausted budget',async()=>{
   await reset();await service.save(1,{...config,max_activations_per_hour:1},1);
   await start();await evaluate();const before=calls.length;
   await service.recover();now++;await feedback();await evaluate();
   await start();
   now+=60001;await fresh();await evaluate();
   assert.equal((await repo.run(1)).status,'RUNNING');
   assert.equal((await repo.runtime(1)).last_reason,'Đã đạt giới hạn phun sương an toàn trong giờ');
   assert.ok(calls.slice(before).every(action=>action==='OFF'));
  });

  await t.test('crop profile changed during downtime faults instead of resuming ON',async()=>{
   await reset();
   const original=repo.profiles;
   const profiles=[{mushroom_type_id:1,temperature_min:24,temperature_max:28,humidity_min:85,humidity_max:95}];
   repo.profiles=async()=>({profiles,trays:[],requiresApproval:false});
   try {
    await service.save(1,{...suggest(profiles).config,profile_approved:true},1);
    await start();await service.recover();
    profiles[0].temperature_max=27;
    now++;await feedback();await evaluate();
    now+=60001;await fresh();await evaluate();
    assert.equal((await repo.run(1)).status,'FAULT');
    await assert.rejects(()=>start(),/Điều kiện trồng trọt của tầng đã thay đổi/);
    assert.ok(calls.every(action=>action==='OFF'));
   }finally{repo.profiles=original;}
  });

  await t.test('manual OFF during leadership loss still ends the run',async()=>{
   await reset();await start();
   beforeOn=async()=>{await service.manual(1,1,'OFF',1);guard=false;};
   await evaluate();await service.recover();
   assert.equal((await repo.run(1)).status,'STOPPED');
   assert.equal((await repo.run(1)).stopped_by,1);
   assert.ok(calls.every(action=>action==='OFF'));
  });

  await t.test('shutdown ends RUNNING and replacement worker only reconciles OFF',async()=>{
   await reset();
   let owner=null;
   const workerRepo={candidates:repo.candidates,acquireLeader:async()=>{
    if(owner)return null;
    const client=new EventEmitter();owner=client;
    client.query=async()=>({rows:[]});client.release=()=>{owner=null;};return client;
   }};
   const a=createWorker(workerRepo,service,{error(){}}),b=createWorker(workerRepo,service,{error(){}});
   try {
    await a.tick();const run=await start();
    await a.tick();assert.equal(calls.at(-1),'ON');
    await a.stop();assert.equal((await repo.run(1)).status,'FAULT');
    assert.equal((await repo.runtime(1)).control_state,'OFF_PENDING');
    assert.equal(calls.at(-1),'OFF');
    now+=30000;await fresh();const before=calls.length;
    await b.tick();assert.ok(calls.length>before);
    assert.ok(calls.slice(before).every(action=>action==='OFF'));
    now++;await feedback();await b.tick();
    now+=60001;await fresh();await b.tick();assert.ok(calls.slice(before).every(action=>action==='OFF'));
    assert.equal((await repo.run(1)).id,run.id);
   }finally{await a.stop();await b.stop();}
  });
 }finally{
  for(const [key,value] of [['AUTO_MISTING_REAL_ENABLED',previousEnabled],['AUTO_MISTING_VERIFIED_WATCHDOGS',previousWatchdogs]])
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  await db.close();
 }
});
