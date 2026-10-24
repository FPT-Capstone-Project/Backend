const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {createWorker}=require('../src/services/autoMisting.worker');
const {createRepository}=require('../src/models/autoMisting.model');

test('only elected worker evaluates; takeover recovers before evaluations; no overlapping ticks',async()=>{
 let owner=null,recoveries=0,evaluations=0,releaseEvaluation;
 const gate=new Promise(resolve=>releaseEvaluation=resolve);
 const clients=[];
 const repo={
  async acquireLeader(){
   if(owner)return null;
   const client=new EventEmitter();owner=client;clients.push(client);
   client.query=async()=>({rows:[]});client.release=()=>{owner=null;};return client;
  },
  candidates:async()=>[{floor_id:1},{floor_id:2}],
 };
 const service={recover:async()=>{recoveries++;},evaluate:async(id,preview,canActuate)=>{
  assert.equal(recoveries>0,true);assert.equal(canActuate(),true);evaluations++;await gate;
 }};
 const logger={error(){}};
 const a=createWorker(repo,service,logger),b=createWorker(repo,service,logger);
 const first=a.tick();await new Promise(resolve=>setImmediate(resolve));
 await a.tick();await b.tick();assert.equal(recoveries,1);assert.equal(evaluations,2);
 releaseEvaluation();await first;await a.stop();
 await b.tick();assert.equal(recoveries,3);assert.equal(evaluations,4);
 await b.stop();assert.equal(owner,null);
});
test('lost leader session prevents activation and forces recovery on next acquisition',async()=>{
 let client,canActivate,recoveries=0;
 const repo={acquireLeader:async()=>{
  client=new EventEmitter();client.query=async()=>({rows:[]});client.release=()=>{};return client;
 },candidates:async()=>[{floor_id:1}]};
 const service={recover:async()=>recoveries++,evaluate:async(id,preview,guard)=>{
  client.emit('error',new Error('connection lost'));canActivate=guard();
 }};
 const w=createWorker(repo,service,{error(){}});
 await w.tick();assert.equal(canActivate,false);
 await w.tick();await w.tick();assert.equal(recoveries,2);await w.stop();
});
test('candidate query failure retries without releasing leadership or stopping AUTO again',async()=>{
 let acquisitions=0,recoveries=0,evaluations=0,releases=0,queries=0;
 const failure=new Error('temporary candidate query failure'),logs=[];
 const client=new EventEmitter();
 client.query=async()=>({rows:[]});client.release=()=>releases++;
 const repo={acquireLeader:async()=>{acquisitions++;return client;},candidates:async()=>{
  if(++queries===1)throw failure;
  return [{floor_id:1}];
 }};
 const w=createWorker(repo,{recover:async()=>recoveries++,evaluate:async(id,preview,guard)=>{
  assert.equal(guard(),true);evaluations++;
 }},{error:(...args)=>logs.push(args)});
 await w.tick();await w.tick();
 assert.equal(acquisitions,1);assert.equal(recoveries,1);
 assert.equal(releases,0);assert.equal(evaluations,1);assert.equal(logs[0][1],failure);
 await w.stop();
});

test('connection error during recovery cannot reopen the actuation gate',async()=>{
 let evaluations=0,releases=0;
 const client=new EventEmitter();
 client.query=async()=>({rows:[]});client.release=()=>releases++;
 const w=createWorker({acquireLeader:async()=>client,candidates:async()=>[{floor_id:1}]},
  {recover:async()=>client.emit('error',new Error('connection lost during recovery')),
   evaluate:async()=>evaluations++},{error(){}});
 await w.tick();
 assert.equal(evaluations,0);assert.equal(releases,1);
 await w.stop();
});

test('leader query failure releases session and recovers on the next acquisition',async()=>{
 let acquisitions=0,recoveries=0,releases=0,fail=false;
 const failure=new Error('heartbeat failed'),logs=[];
 const repo={acquireLeader:async()=>{
  acquisitions++;
  const client=new EventEmitter();
  client.query=async()=>{if(fail){fail=false;throw failure;}return {rows:[]};};
  client.release=broken=>{assert.equal(broken,true);releases++;};return client;
 },candidates:async()=>[]};
 const w=createWorker(repo,{recover:async()=>recoveries++},{error:(...args)=>logs.push(args)});
 await w.tick();fail=true;await w.tick();await w.tick();
 assert.equal(acquisitions,2);assert.equal(recoveries,2);assert.equal(releases,1);
 assert.equal(logs[0][1],failure);
 // Force another session failure so stop has no live client to release normally.
 fail=true;await w.tick();await w.stop();
});

test('failed leader acquisition destroys the checked-out connection',async()=>{
 const failure=new Error('lock query failed'),released=[];
 const repo=createRepository({connect:async()=>({query:async()=>{throw failure;},release:broken=>released.push(broken)})});
 await assert.rejects(()=>repo.acquireLeader(),error=>error===failure);
 assert.deepEqual(released,[true]);
});

test('repository session locks share one connection, serialize keys and release on errors',async()=>{
 const statements=[];let released=0,connections=0;
 const client={query:async(sql,args)=>{statements.push({sql,args});return {rows:[]};},release:()=>released++};
 const repo=createRepository({connect:async()=>{connections++;return client;}});
 await assert.rejects(()=>repo.lockFloor(3,()=>repo.lockChannel(2,1,async()=>{
  assert.equal(repo.currentConnection(),client);await repo.rows('SELECT 1');throw new Error('test');
 })),/test/);
 assert.equal(connections,1);assert.equal(released,1);
 assert.deepEqual(statements.filter(s=>s.sql.includes('pg_advisory_lock')).map(s=>s.args),[[62001,3],[62002,17]]);
 assert.equal(statements.filter(s=>s.sql.includes('pg_advisory_unlock')).length,2);
 assert.equal(repo.currentConnection(),undefined);
});
