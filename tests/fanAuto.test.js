const test=require('node:test');
const assert=require('node:assert/strict');
const {createService}=require('../src/services/fanAuto.service');

function fixture() {
 let clock=Date.parse('2026-11-16T00:00:00Z'), config=null, feedback=null, online=true, ready=true;
 const commands=[], events=[];
 const floor=()=>({floor_id:1,status:'ACTIVE',master_id:1,master_identifier:'master01',fan_ssr_channel:4,misting_ssr_channel:1,
  reported_status:online?'online':'offline',last_seen_at:new Date(clock)});
 const repo={
  floor:async()=>floor(),get:async()=>config&&{...config},feedback:async()=>feedback,
  lockFloor:async(id,work)=>work(),lockChannel:async(master,channel,work)=>work(),workerReady:async()=>ready,
  canManage:async()=>true,
  candidates:async()=>config&&(config.enabled||config.state!=='STOPPED')?[{floor_id:1}]:[],
  byChannel:async(m,ch)=>config?.master_id===m&&config.channel===ch&&(config.enabled||config.state!=='STOPPED')?{...config}:null,
  logs:async()=>events,
  save:async(id,run,rest)=>config={floor_id:id,run_minutes:run,rest_minutes:rest,enabled:false,state:'STOPPED',dry_run:true},
  set:async(id,values,event)=>{config={...config,...values};if(event)events.push({event_type:event});return {...config};},
 };
 let publishFailure=false;
 const command=async(master,channel,body,user,internal)=>{
  await internal.beforePublish?.(); internal.authorizePublish?.();
  commands.push({master,channel,action:body.action});
  feedback={...feedback,desired_state:body.action};
  if(publishFailure)throw Object.assign(new Error('MQTT unavailable'),{statusCode:503});
 };
 const env={FAN_AUTO_REAL_ENABLED:'true',FAN_AUTO_VERIFIED_WATCHDOGS:'{"master01/4":600000}'};
 const engine=createService(repo,{isReady:()=>online},command,()=>clock,env);
 const service={...engine,
  save:async(id,c)=>repo.save(id,c.runMinutes,c.restMinutes),
  start:async(id,options={})=>{config={...config,enabled:true,dry_run:options.dryRun??true,state:'OFF_PENDING',after_off:'RUN',master_id:1,channel:4,requested_at:new Date(clock)};},
  stop:async id=>{config.enabled=false;return engine.stop(id);},
 };
 return {service,commands,events,env,repo,
  get config(){return config;},get clock(){return clock;},
  advance:ms=>clock+=ms, disconnect:()=>online=false,connect:()=>online=true,
  workerDown:()=>ready=false,failPublish:()=>publishFailure=true,
  ack:(state,retained=false)=>{feedback={reported_state:state,desired_state:state,reported_retained:retained,state_reported_at:new Date(clock)};},
  tick:async()=>{clock++;await service.evaluate(1);},
 };
}
async function startReal(f) {
 await f.service.save(1,{runMinutes:2,restMinutes:3},1);
 await f.service.start(1,{dryRun:false},1);
 await f.tick();f.ack('OFF');await f.tick();await f.tick();f.ack('ON');await f.tick();
 assert.equal(f.config.state,'RUNNING');
}

test('dry cycle persists run/rest deadlines, repeats, and publishes nothing',async()=>{
 const f=fixture();await f.service.save(1,{runMinutes:1,restMinutes:2},1);await f.service.start(1,{},1);
 await f.tick();await f.tick();await f.tick();assert.equal(f.config.state,'RUNNING');
 f.advance(60000);await f.tick();assert.equal(f.config.state,'RESTING');
 f.advance(120000);await f.tick();await f.tick();await f.tick();assert.equal(f.config.state,'RUNNING');
 assert.equal(f.commands.length,0);
 await f.service.stop(1);assert.equal(f.config.state,'STOPPED');await f.tick();assert.equal(f.config.enabled,false);
});
test('real cycle requires fresh non-retained OFF and ON, and uses the fan channel only',async()=>{
 const f=fixture();await f.service.save(1,{runMinutes:2,restMinutes:3},1);f.ack('OFF');f.advance(100);
 await f.service.start(1,{dryRun:false},1);await f.tick();assert.equal(f.config.state,'OFF_PENDING');
 f.ack('OFF',true);await f.tick();assert.equal(f.config.state,'OFF_PENDING');
 f.ack('OFF');await f.tick();assert.equal(f.config.state,'READY');
 await f.tick();assert.equal(f.config.state,'ON_PENDING');
 f.ack('ON',true);await f.tick();assert.equal(f.config.state,'ON_PENDING');
 f.ack('ON');await f.tick();assert.equal(f.config.state,'RUNNING');
 f.advance(120000);await f.tick();assert.equal(f.config.state,'OFF_PENDING');
 f.ack('OFF');await f.tick();assert.equal(f.config.state,'RESTING');
 assert.ok(f.commands.every(command=>command.channel===4));
 assert.deepEqual(f.commands.map(c=>c.action),['OFF','ON','OFF']);
});
test('missing ON feedback and uncertain publish result both request OFF, never assume running',async()=>{
 for(const fail of [false,true]) {
  const f=fixture();await f.service.save(1,{runMinutes:2,restMinutes:3},1);await f.service.start(1,{dryRun:false},1);
  await f.tick();f.ack('OFF');await f.tick();if(fail)f.failPublish();await f.tick();
  f.advance(5001);await f.tick();assert.equal(f.config.state,'OFF_PENDING');assert.equal(f.config.enabled,true);
  assert.equal(f.commands.filter(c=>c.action==='ON').length,1);
 }
});
test('restart discards interrupted run, confirms OFF, then waits a full rest without catch-up',async()=>{
 const f=fixture();await startReal(f);f.advance(3600000);
 await f.service.recover();assert.equal(f.config.state,'OFF_PENDING');
 f.ack('OFF');await f.tick();assert.equal(f.config.state,'RESTING');
 assert.equal(new Date(f.config.deadline_at).getTime(),f.clock+180000);
 assert.equal(f.commands.filter(c=>c.action==='ON').length,1);
});
test('loss of leadership immediately before ON publication cannot leave a running cycle',async()=>{
 const f=fixture();await f.service.save(1,{runMinutes:2,restMinutes:3},1);await f.service.start(1,{dryRun:false},1);
 await f.tick();f.ack('OFF');await f.tick();let checks=0;
 await f.service.evaluate(1,()=>++checks<3);
 assert.equal(f.config.state,'OFF_PENDING');assert.equal(f.commands.some(c=>c.action==='ON'),false);
});

test('feedback arriving after the ON deadline never extends a run and overdue rest starts only one cycle',async()=>{
 const f=fixture();await startReal(f);f.advance(120000);f.ack('ON');await f.tick();
 assert.equal(f.config.state,'OFF_PENDING');f.ack('OFF');await f.tick();
 f.advance(86400000);await f.tick();f.ack('OFF');await f.tick();await f.tick();f.ack('ON');await f.tick();
 assert.equal(f.config.state,'RUNNING');assert.equal(f.commands.filter(c=>c.action==='ON').length,2);
});

