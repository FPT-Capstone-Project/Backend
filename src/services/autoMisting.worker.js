const repository=require('../models/autoMisting.model');
const service=require('./autoMisting.service');
const {randomUUID}=require('node:crypto');

// A dedicated session elects one worker. Losing that session closes the local
// actuation gate; a replacement always stops old runs before doing evaluations.
function createWorker(repo=repository,control=service,logger=console) {
 let timer,leader,busy=false,stopping=false,healthy=false;
 const workerId=randomUUID();
 let recoveryReason='Worker initial leadership acquisition (startup or takeover)';
 let sessionFailure;
 const diagnostics=stage=>({workerId,pid:process.pid,uptimeSeconds:Math.floor(process.uptime()),stage,at:new Date().toISOString()});
 function failureReason(stage,error) {
  // Persist a bounded error code, not arbitrary database error text in the API.
  const code=/^[A-Z0-9_]{1,40}$/.test(error?.code || '')?` (${error.code})`:'';
  return `Worker leadership reacquired after ${stage}${code}`;
 }
 async function tick() {
  if(busy || stopping)return;
  busy=true;
  let stage='leader acquisition';
  try {
   if(!leader) {
    leader=await repo.acquireLeader();
    if(!leader)return;
    healthy=true;
    sessionFailure=null;
    const session=leader;
    leader.on?.('error',error=>{
     if(leader!==session || stopping)return;
     healthy=false;
     sessionFailure=failureReason('database session error',error);
     logger.error('Auto misting leader connection failed',error,diagnostics('database session error'));
    });
    leader.on?.('end',()=>{
     if(leader!==session || stopping || sessionFailure)return;
     healthy=false;
     sessionFailure=failureReason('database session closed');
     logger.error('Auto misting leader connection closed',diagnostics('database session closed'));
    });
    stage='recovery';
    logger.info?.('Auto misting leadership acquired; stopping prior runs',{...diagnostics(stage),reason:recoveryReason});
    await control.recover(recoveryReason);
   }
   stage='leader health check';
   await leader.query('SELECT 1');
   if(!healthy)throw new Error('Worker leadership lost');
   stage='heartbeat update';
   await leader.query(`INSERT INTO iot_auto_control_worker(id,heartbeat_at) VALUES(1,now())
    ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()`);
   let floors;
   try {floors=await repo.candidates();}
   catch(error) {
    // This query uses the pool, not the session holding the leader lock.
    // Retry next tick without triggering takeover recovery for unrelated errors.
    logger.error('Auto misting candidate query failed; retrying next tick',error,diagnostics('candidate query'));
    return;
   }
   // Bounded parallelism keeps one delayed device from blocking every floor.
   for(let i=0;i<floors.length;i+=2) {
    await Promise.all(floors.slice(i,i+2).map(async f=>{
     try {await control.evaluate(f.floor_id,false,()=>healthy && !stopping);}
     catch(error) {logger.error(`Auto misting evaluation failed for floor ${f.floor_id}`,error);}
    }));
   }
  } catch(error) {
   healthy=false;
   if(leader){
    recoveryReason=sessionFailure || failureReason(stage,error);
    const session=leader;leader=null;session.release(true);
   }
   logger.error('Auto misting worker unavailable; no runs resumed',error,diagnostics(stage));
  } finally {busy=false;}
 }
 return {
  start(){if(timer)return;stopping=false;timer=setInterval(tick,250);timer.unref();void tick();},
  tick,
  async stop(){
   stopping=true;clearInterval(timer);timer=null;
   while(busy)await new Promise(resolve=>setTimeout(resolve,25));
   if(leader) {
    try {await leader.query('DELETE FROM iot_auto_control_worker');await control.recover('Backend shutdown');await leader.query('SELECT pg_advisory_unlock(62003,1)');}
    finally{leader.release();leader=null;healthy=false;}
   }
  },
 };
}
module.exports={...createWorker(),createWorker};
