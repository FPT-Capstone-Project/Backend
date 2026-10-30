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
 const previousEnabled=process.env.AUTO_MISTING_REAL_ENABLED,previousWatchdogs=process.env.AUTO_MISTING_VERIFIED_WATCHDOGS;
 process.env.AUTO_MISTING_REAL_ENABLED='false';process.env.AUTO_MISTING_VERIFIED_WATCHDOGS='{}';
 const db=new PGlite();
 let now=Date.now(),connected=true,failOn=false,failOff=false,beforeOn,startFeedback='live';
 const calls=[];
 const repo=createRepository(db);
 const dbPath=require.resolve('../src/config/db'),originalDb=require.cache[dbPath];
 require.cache[dbPath]={exports:{query:(...args)=>db.query(...args),connect:async()=>({query:(...args)=>db.query(...args),release(){}})}};
 require.cache[dbPath]=originalDb;
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
  if((body.action==='ON' && failOn) || (body.action==='OFF' && failOff)) {
   const error=new Error('Mock MQTT publication failed');
   if(typeof failOn==='number' && body.action==='ON')error.statusCode=failOn;
   throw error;
  }
  if(body.action==='OFF' && internal.beforePublish && startFeedback!=='none') {
   now+=1;
   await db.query("UPDATE iot_ssr_states SET reported_state='OFF',desired_state='OFF',reported_retained=$3,state_reported_at=$1 WHERE master_id=1 AND channel=$2",[new Date(now),channel,startFeedback==='retained']);
  }
  return {};
  };
  return internal.lockHeld?publish():repo.lockChannel(1,channel,publish);
 };
 const service=createService(repo,{isReady:()=>connected},command,()=>now,async ms=>{now+=ms;});
 const fresh=async()=>{await db.query('UPDATE iot_sensor_latest SET last_received_at=$1',[new Date(now)]);await db.exec('UPDATE iot_auto_control_worker SET heartbeat_at=now()');};
 try{
  await db.exec(fs.readFileSync('database.sql','utf8'));
  await db.exec("INSERT INTO roles(role_name) VALUES('Farm Operator'),('Admin'),('Customer'); INSERT INTO cultivation_rooms(room_code,room_name) VALUES('R1','Room one'),('R2','Room two'); INSERT INTO cultivation_trays(room_id,tray_code) VALUES(1,'T1'); INSERT INTO mushroom_types(name,growing_days,price) VALUES('Test mushroom',30,1);");
  // Fresh database.sql already includes IoT and automation. Roles are seeded
  // afterward, so apply the same named-role grants to this test fixture.
  await db.exec(`INSERT INTO role_permissions(role_id,permission_id)
   SELECT r.role_id,p.permission_id FROM roles r CROSS JOIN permissions p
   WHERE lower(regexp_replace(r.role_name,'[ _-]','','g')) IN ('admin','farmoperator')
   AND p.permission_name='iot.automation.manage' ON CONFLICT DO NOTHING`);
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
   await assert.rejects(()=>service.start(id,{},null),/Dừng chế độ tự động/);
   await assert.rejects(()=>service.save(id,config,null),/Dừng chế độ tự động/);
   await assert.rejects(()=>service.map(id,{room_id:1,floor_number:1,floor_name:'Edit',master_id:1,node_address:1,misting_ssr_channel:1}),/Dừng chế độ tự động/);
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
  await t.test('restart preserves AUTO, discards the old pulse and observes cooldown',async()=>{
   now+=61000;await fresh();await service.evaluate(id);assert.equal((await repo.runtime(id)).control_state,'MISTING');
   const run=await repo.run(id),budget=await repo.budget(id);
   await service.recover();assert.equal((await repo.run(id)).status,'RUNNING');
   assert.equal((await repo.run(id)).id,run.id);
   assert.equal((await repo.runtime(id)).control_state,'COOLDOWN');
   assert.equal((await repo.runtime(id)).pulse_deadline_at,null);
   assert.deepEqual(await repo.budget(id),budget);
   assert.equal((await repo.run(other)).status,'STOPPED');
   assert.equal((await service.evaluate(id)).action,'NONE');assert.equal(calls.length,0);
   await service.stop(id,null);
  });
  await t.test('real Start sends OFF and refuses old, retained or missing feedback without creating a run',async()=>{
   process.env.AUTO_MISTING_REAL_ENABLED='true';process.env.AUTO_MISTING_VERIFIED_WATCHDOGS='{"master01":10000}';
   await db.query("INSERT INTO iot_ssr_states(master_id,channel,reported_state,reported_retained,state_reported_at) VALUES(1,1,'OFF',false,$1)",[new Date(now)]);
   const previous=(await repo.run(id)).id;
   for(const feedback of ['none','retained']) {
    await fresh();startFeedback=feedback;
    await assert.rejects(()=>service.start(id,{dryRun:false},null),error=>error.statusCode===504 && /chưa bật chế độ tự động/.test(error.message));
    assert.equal(calls.at(-1).action,'OFF');
    assert.equal((await repo.run(id)).id,previous);
    assert.equal((await service.status(id)).mode,'MANUAL');
   }
   startFeedback='live';failOff=true;await fresh();
   await assert.rejects(()=>service.start(id,{dryRun:false},null),/publication failed/);
   assert.equal((await repo.run(id)).id,previous);failOff=false;
  });
  await t.test('real mocked pulse uses existing command service and OFF never waits for delayed ON feedback',async()=>{
   process.env.AUTO_MISTING_REAL_ENABLED='true';process.env.AUTO_MISTING_VERIFIED_WATCHDOGS='{"master01":10000}';
   await fresh();await db.query("UPDATE iot_ssr_states SET reported_state='ON',desired_state='ON',state_reported_at=$1 WHERE master_id=1 AND channel=1",[new Date(now-30000)]);
   await service.start(id,{dryRun:false},null);
   assert.equal(calls.at(-1).action,'OFF');
   assert.equal((await repo.run(id)).status,'RUNNING');
   await service.evaluate(id);
   assert.equal(calls.at(-1).action,'ON');
   now+=5000;await fresh();await service.evaluate(id);assert.equal(calls.at(-1).action,'OFF');
   assert.equal((await repo.runtime(id)).control_state,'OFF_PENDING');
   await assert.rejects(()=>service.manual(1,1,'ON',null),/đang quản lý kênh này/);
   await assert.rejects(()=>service.manual(1,1,'OFF',null),/quyền quản lý tự động hóa/);
   now+=17000;await db.query("UPDATE iot_ssr_states SET reported_state='ON',state_reported_at=$1",[new Date(now)]);
   await service.evaluate(id);assert.equal((await repo.runtime(id)).control_state,'OFF_PENDING');
   now+=3000;await db.query("UPDATE iot_ssr_states SET reported_state='OFF',state_reported_at=$1",[new Date(now)]);
   await service.evaluate(id);assert.equal((await repo.runtime(id)).control_state,'COOLDOWN');
   now+=60001;await fresh();
   const nextPulse=calls.length;
   await service.evaluate(id);
   assert.deepEqual(calls.slice(nextPulse).map(c=>c.action),['OFF','ON']);
   assert.equal((await repo.run(id)).status,'RUNNING');
   assert.equal((await repo.runtime(id)).control_state,'MISTING');
   now+=5000;await fresh();await service.evaluate(id);
   now+=1;await db.query("UPDATE iot_ssr_states SET reported_state='OFF',reported_retained=false,state_reported_at=$1",[new Date(now)]);
   await service.evaluate(id);
   await service.stop(id,null);assert.equal((await service.status(id)).mode,'MANUAL');
  });
  await t.test('OFF refresh rejects missing or retained feedback without publishing ON',async()=>{
   for(const feedback of ['none','retained']) {
    startFeedback='live';await fresh();await service.start(id,{dryRun:false},null);
    now+=60001;await fresh();startFeedback=feedback;
    const before=calls.length;
    await service.evaluate(id);
    assert.ok(calls.slice(before).length>0);
    assert.ok(calls.slice(before).every(c=>c.action==='OFF'));
    assert.equal((await repo.run(id)).status,'RUNNING');
    assert.equal((await repo.runtime(id)).control_state,'OFF_PENDING');
    now+=5001;await service.evaluate(id);
    assert.ok(calls.slice(before).every(c=>c.action==='OFF'));
    await service.stop(id,null);
    now+=1;await db.query("UPDATE iot_ssr_states SET reported_state='OFF',reported_retained=false,state_reported_at=$1",[new Date(now)]);
    await service.evaluate(id);
   }
   startFeedback='live';
  });
  await t.test('retained OFF is refreshed and sensor health is rechecked before ON',async()=>{
   await fresh();await service.start(id,{dryRun:false},null);
   await fresh();
   await db.exec('UPDATE iot_ssr_states SET reported_retained=true WHERE channel=1');
   // Sensor data is still valid at evaluation, but expires during OFF refresh.
   now+=config.sensor_max_age_ms;
   const before=calls.length;
   await service.evaluate(id);
   assert.deepEqual(calls.slice(before).map(c=>c.action),['OFF']);
   assert.equal((await repo.run(id)).status,'RUNNING');
   assert.match((await repo.runtime(id)).last_error,/quá cũ/);
   await service.stop(id,null);
  });
  await t.test('temporary sensor and connection failures wait and recover in the same AUTO run',async()=>{
   await fresh();const started=await service.start(id,{dryRun:false},null);
   now+=20001;const before=calls.length;
   assert.equal((await service.evaluate(id)).action,'NONE');
   assert.equal((await repo.runtime(id)).control_state,'SENSOR_FAULT');
   assert.equal((await service.status(id)).mode,'AUTO');
   now+=5001;await fresh();connected=false;
   await service.evaluate(id);
   assert.equal((await repo.runtime(id)).control_state,'DEVICE_OFFLINE');
   assert.equal(calls.length,before);
   connected=true;now+=5001;await fresh();await service.evaluate(id);
   assert.equal((await repo.run(id)).id,started.run.id);
   assert.equal((await repo.runtime(id)).control_state,'MISTING');
   assert.equal((await repo.runtime(id)).last_error,null);
   await service.stop(id,null);
   now+=1;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);await service.evaluate(id);
  });
  await t.test('ON timeout keeps AUTO but requires live OFF and cooldown before a new pulse',async()=>{
   await fresh();const started=await service.start(id,{dryRun:false},null);
   failOn=504;await service.evaluate(id);failOn=false;
   assert.equal((await repo.run(id)).status,'RUNNING');
   assert.equal((await repo.runtime(id)).control_state,'OFF_PENDING');
   const onCount=calls.filter(c=>c.action==='ON').length;
   now+=5001;await fresh();await service.evaluate(id);
   assert.equal(calls.filter(c=>c.action==='ON').length,onCount);
   now+=1;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);await service.evaluate(id);
   assert.equal((await repo.runtime(id)).control_state,'COOLDOWN');
   now+=5001;await fresh();await service.evaluate(id);
   assert.equal(calls.filter(c=>c.action==='ON').length,onCount);
   now+=60001;await fresh();await service.evaluate(id);
   assert.equal(calls.filter(c=>c.action==='ON').length,onCount+1);
   assert.equal((await repo.run(id)).id,started.run.id);
   await service.stop(id,null);
   now+=1;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);await service.evaluate(id);
  });
  await t.test('stale sensors and disconnected MQTT prevent real Start',async()=>{
   now+=30000;await assert.rejects(()=>service.start(id,{dryRun:false},null),/quá cũ/);
   await fresh();connected=false;await assert.rejects(()=>service.start(id,{dryRun:false},null),/mất kết nối/);connected=true;
  });
  await t.test('retained and invalid sensor samples block dry Start too',async()=>{
   await db.exec('UPDATE iot_sensor_latest SET retained=true WHERE node_address=1 AND sensor_address=1');
   await assert.rejects(()=>service.start(id,{},null),/bản tin lưu giữ/);
   await db.exec('UPDATE iot_sensor_latest SET retained=false,is_valid=false WHERE node_address=1 AND sensor_address=1');
   await assert.rejects(()=>service.start(id,{},null),/không hợp lệ/);
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
   await assert.rejects(()=>service.start(id,{dryRun:false},1),/hoàn tất xác nhận tắt/);
   const onCount=calls.filter(c=>c.action==='ON').length;
   failOff=false;now+=3000;await service.recover();
   assert.equal(calls.filter(c=>c.action==='ON').length,onCount);assert.equal(calls.at(-1).action,'OFF');
   now+=3000;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);await service.evaluate(id);
   assert.equal((await repo.runtime(id)).control_state,'DISABLED');
  });
  await t.test('sensor fault during pulse requests OFF and waits for recovery',async()=>{
   await fresh();await service.start(id,{dryRun:false},1);await service.evaluate(id);
   await db.exec('UPDATE iot_sensor_latest SET is_valid=false WHERE node_address=1 AND sensor_address=1');
   now+=1000;await service.evaluate(id);
   assert.equal((await repo.run(id)).status,'RUNNING');assert.equal(calls.at(-1).action,'OFF');
   now+=3000;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);await service.evaluate(id);
   assert.equal((await service.evaluate(id)).action,'NONE');
   await service.stop(id,null);
  });
  await t.test('unassigned trays require an explicitly named approved floor profile',async()=>{
   await db.exec("UPDATE iot_sensor_latest SET is_valid=true; INSERT INTO cultivation_trays(room_id,tray_code) VALUES(1,'T2')");await fresh();
   await assert.rejects(()=>service.start(id,{},1),/cấu hình tầng đã đặt tên và được phê duyệt/);
   await service.save(id,{...config,profile_name:'Operator approved mixed floor',profile_approved:true},1);
   await service.start(id,{},1);await service.stop(id,1);
   const saved=await repo.config(id);assert.equal(saved.configured_by,1);
   assert.equal((await repo.run(id)).started_by,1);assert.equal((await repo.run(id)).stopped_by,1);
  });
  await t.test('shared floor config is saved without a representative mushroom; hot humid-safe readings trigger real mocked ON',async()=>{
    assert.equal((await service.suggestions(id)).config,null);
    await db.exec(`
     INSERT INTO mushroom_types(name,growing_days,price) VALUES('Second mushroom',30,1);
     INSERT INTO mushroom_conditions(mushroom_type_id,temperature_min,temperature_max,humidity_min,humidity_max)
      VALUES(1,24,28,85,95),(2,25,29,88,96);
     INSERT INTO rental_packages(package_name,duration_days,price) VALUES('Test package',30,1);
     INSERT INTO orders(user_id,status,payment_status) VALUES(1,'PROCESSING','PAID'),(1,'PROCESSING','PAID');
     INSERT INTO order_items(order_id,item_type,rental_package_id,mushroom_type_id,unit_price,total_price)
      VALUES(1,'CULTIVATION',1,1,1,1),(2,'CULTIVATION',1,2,1,1);
     INSERT INTO cultivation_sessions(mushroom_type_id,start_at,duration_days,status,order_item_id)
      VALUES(1,CURRENT_TIMESTAMP,30,'ACTIVE',1),(2,CURRENT_TIMESTAMP,30,'ACTIVE',2);
     INSERT INTO cultivation_session_trays(session_id,tray_id,status)
      VALUES(1,1,'ACTIVE'),(2,2,'ACTIVE');
     UPDATE cultivation_trays SET status='OCCUPIED' WHERE tray_id IN (1,2);
    `);
    await service.assignTray(id,2);
    assert.equal((await repo.rows('SELECT * FROM cultivation_sessions')).length,2);
    const cultivation=(await service.configuration(id)).cultivation;
    assert.equal(cultivation.trays.length,2);
    assert.equal(cultivation.trays[0].session_tray_id,1);
    assert.equal(cultivation.trays[1].mushroom_name,'Second mushroom');
    await db.exec("UPDATE cultivation_sessions SET status='COMPLETED' WHERE session_id=2");
    assert.equal((await service.suggestions(id)).sourceProfiles.length,1);
    await db.exec("UPDATE cultivation_sessions SET status='ACTIVE' WHERE session_id=2");
    const suggestion=await service.suggestions(id);
    assert.equal(suggestion.common.humidity_min,88);
    assert.equal(suggestion.common.temperature_max,28);
    await assert.rejects(()=>service.save(id,suggestion.config,1),/phê duyệt/);
    await service.save(id,{...suggestion.config,profile_approved:true},1);
    const saved=await repo.config(id);
    assert.equal(saved.mushroom_type_id,null);assert.equal(saved.source_profiles.length,2);
    await db.exec('UPDATE iot_sensor_latest SET temperature=30,humidity=93,is_valid=true');
    await fresh();await db.query("UPDATE iot_ssr_states SET reported_state='OFF',state_reported_at=$1",[new Date(now)]);
    await service.start(id,{dryRun:false},1);
    await service.evaluate(id);
    assert.equal(calls.at(-1).action,'ON');
    assert.equal((await repo.runtime(id)).cooling_demand,true);
    assert.equal((await repo.runtime(id)).demand,false);
    const entry=await repo.one("SELECT * FROM iot_auto_control_logs WHERE floor_id=$1 AND event_type='PULSE_RESERVED' ORDER BY id DESC LIMIT 1",[id]);
    assert.equal(entry.average_temperature,30);
    await db.exec('UPDATE iot_sensor_latest SET humidity=94');
    now+=250;await service.evaluate(id);
    assert.equal(calls.at(-1).action,'OFF');
    now+=3000;await db.query("UPDATE iot_ssr_states SET state_reported_at=$1",[new Date(now)]);
    await service.evaluate(id);await service.stop(id,1);
    await db.exec('UPDATE mushroom_conditions SET temperature_max=27 WHERE mushroom_type_id=2');
    await assert.rejects(()=>service.start(id,{},1),/đã thay đổi/);
    const revised=await service.suggestions(id);
    await service.save(id,{...revised.config,profile_approved:true},1);
    await db.exec('UPDATE iot_sensor_latest SET humidity=93');
    await fresh();await service.start(id,{},1);
    await service.evaluate(id);
    assert.equal((await repo.runtime(id)).control_state,'MISTING');
    await db.exec('UPDATE mushroom_conditions SET humidity_min=89 WHERE mushroom_type_id=2');
    await assert.rejects(()=>service.evaluate(id,true),/đã thay đổi/);
    assert.equal((await repo.run(id)).status,'RUNNING');
    await service.evaluate(id);
    assert.equal((await repo.run(id)).status,'FAULT');
    assert.equal((await repo.runtime(id)).control_state,'DISABLED');
    await db.exec('UPDATE mushroom_conditions SET humidity_min=96,humidity_max=99 WHERE mushroom_type_id=2');
    assert.equal((await service.suggestions(id)).config,null);
    await db.exec('UPDATE mushroom_conditions SET humidity_min=88,humidity_max=96 WHERE mushroom_type_id=2');
    const currentSuggestion=await service.suggestions(id);
    await service.save(id,{...currentSuggestion.config,profile_approved:true},1);
    await fresh();await service.start(id,{},1);await service.evaluate(id);
    assert.equal((await repo.runtime(id)).control_state,'MISTING');
    await db.exec("UPDATE cultivation_sessions SET status='COMPLETED' WHERE session_id=2");
    await service.evaluate(id);
    assert.equal((await repo.run(id)).status,'FAULT');
    assert.equal((await repo.runtime(id)).control_state,'DISABLED');
    assert.equal((await service.suggestions(id)).sourceProfiles.length,1);
    await db.exec("UPDATE cultivation_sessions SET status='CANCELLED' WHERE session_id=1");
    assert.equal((await service.suggestions(id)).config,null);
    await assert.rejects(()=>service.start(id,{},1),/không có phiên trồng đang hoạt động/);
  });
 }finally{
  for(const [key,value] of [['AUTO_MISTING_REAL_ENABLED',previousEnabled],['AUTO_MISTING_VERIFIED_WATCHDOGS',previousWatchdogs]])
   if(value===undefined)delete process.env[key];else process.env[key]=value;
  await db.close();
 }
});
