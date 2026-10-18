const repository=require('../models/autoMisting.model');
const service=require('./autoMisting.service');

// A dedicated session elects one worker. Losing that session closes the local
// actuation gate; a replacement always stops old runs before doing evaluations.
function createWorker(repo=repository,control=service,logger=console) {
 let timer,leader,busy=false,stopping=false,healthy=false;
 async function tick() {
  if(busy || stopping)return;
  busy=true;
  try {
   if(!leader) {
    leader=await repo.acquireLeader();
    if(!leader)return;
    leader.on?.('error',()=>{healthy=false;});
    await control.recover();
    healthy=true;
   }
   await leader.query('SELECT 1');
   if(!healthy)throw new Error('Worker leadership lost');
   await leader.query(`INSERT INTO iot_auto_control_worker(id,heartbeat_at) VALUES(1,now())
    ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()`);
   const floors=await repo.candidates();
   // Bounded parallelism keeps one delayed device from blocking every floor.
   for(let i=0;i<floors.length;i+=2) {
    await Promise.all(floors.slice(i,i+2).map(async f=>{
     try {await control.evaluate(f.floor_id,false,()=>healthy && !stopping);}
     catch {logger.error(`Auto misting evaluation failed for floor ${f.floor_id}`);}
    }));
   }
  } catch {
   healthy=false;
   if(leader){leader.release(true);leader=null;}
   logger.error('Auto misting worker unavailable; no runs resumed');
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
