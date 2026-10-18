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
