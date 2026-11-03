const repository=require('../models/autoMisting.model');
const service=require('./autoMisting.service');
const mqtt=require('./iotMqtt.service');
const {randomUUID}=require('node:crypto');

// A dedicated session elects one worker. Losing that session closes the local
// actuation gate; a replacement pauses interrupted runs and reconciles OFF.
function createWorker(repo=repository,control=service,logger=console,transport=mqtt) {
 let timer,heartbeatTimer,heartbeatPending,leader,busy=false,stopping=false,healthy=false;
 const transportVersion=()=>transport.getDisconnectVersion?.() ?? 0;
 let observedTransportVersion=transportVersion();
 const workerId=randomUUID();
 let recoveryReason='Tiến trình lần đầu nhận quyền điều khiển chính (khởi động hoặc tiếp quản)';
 let sessionFailure;
 const diagnostics=stage=>({workerId,pid:process.pid,uptimeSeconds:Math.floor(process.uptime()),stage,at:new Date().toISOString()});
 function stopHeartbeat() {clearInterval(heartbeatTimer);heartbeatTimer=null;}
 function heartbeat() {
  if(heartbeatPending)return heartbeatPending;
  const session=leader;
  if(!session || !healthy || stopping || observedTransportVersion!==transportVersion())return Promise.resolve();
  heartbeatPending=(async()=>{
   await session.query(`INSERT INTO iot_auto_control_worker(id,heartbeat_at) VALUES(1,now())
    ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()`);
  })().finally(()=>{heartbeatPending=null;});
  return heartbeatPending;
 }
 function startHeartbeat() {
  if(heartbeatTimer)return;
  // The elected session is independent of floor locks and MQTT publication.
  // Never overlap heartbeat queries or publish readiness during recovery.
  heartbeatTimer=setInterval(()=>{
   void heartbeat().catch(error=>{
    healthy=false;stopHeartbeat();
    sessionFailure=sessionFailure || failureReason('cập nhật tín hiệu hoạt động',error);
    logger.error('Không thể cập nhật tín hiệu hoạt động của worker AUTO',error,diagnostics('cập nhật tín hiệu hoạt động'));
   });
  },1000);
  heartbeatTimer.unref();
 }
 function failureReason(stage,error) {
  // Persist a bounded error code, not arbitrary database error text in the API.
  const code=/^[A-Z0-9_]{1,40}$/.test(error?.code || '')?` (${error.code})`:'';
  return `Tiến trình đã nhận lại quyền điều khiển chính sau sự cố tại bước ${stage}${code}`;
 }
 async function tick() {
  if(busy || stopping)return;
  busy=true;
  let stage='nhận quyền điều khiển chính';
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
     sessionFailure=failureReason('lỗi phiên kết nối cơ sở dữ liệu',error);
     logger.error('Lỗi kết nối của tiến trình điều khiển phun sương chính',error,diagnostics('lỗi phiên kết nối cơ sở dữ liệu'));
    });
    leader.on?.('end',()=>{
     if(leader!==session || stopping || sessionFailure)return;
     healthy=false;
     sessionFailure=failureReason('phiên kết nối cơ sở dữ liệu đã đóng');
     logger.error('Kết nối của tiến trình điều khiển phun sương chính đã đóng',diagnostics('phiên kết nối cơ sở dữ liệu đã đóng'));
    });
    stage='khôi phục';
    logger.info?.('Đã nhận quyền điều khiển phun sương chính; đang xác nhận OFF trước khi tiếp tục AUTO bị gián đoạn',{...diagnostics(stage),reason:recoveryReason});
    await control.recover(recoveryReason);
   }
   if(observedTransportVersion!==transportVersion()) {
    stopHeartbeat();
    if(heartbeatPending)await heartbeatPending;
    const version=transportVersion();
    stage='tạm chờ AUTO sau mất kết nối MQTT';
    await control.recover('Mất kết nối MQTT; AUTO tạm chờ xác nhận OFF và kiểm tra điều kiện để tiếp tục');
    observedTransportVersion=version;
   }
   stage='kiểm tra hoạt động của tiến trình điều khiển chính';
   await leader.query('SELECT 1');
   if(!healthy)throw new Error('Tiến trình đã mất quyền điều khiển chính');
   stage='cập nhật tín hiệu hoạt động';
   await heartbeat();
   if(!healthy)throw new Error('Tiến trình đã mất quyền điều khiển chính');
   if(stopping)return;
   startHeartbeat();
   stage='truy vấn các tầng cần điều khiển';
   const floors=await repo.candidates();
   // Bounded parallelism keeps one delayed device from blocking every floor.
   for(let i=0;i<floors.length;i+=2) {
    stage='đánh giá các tầng';
    const results=await Promise.allSettled(floors.slice(i,i+2).map(async f=>{
     try {await control.evaluate(f.floor_id,false,()=>healthy && !stopping && observedTransportVersion===transportVersion());}
     catch(error) {healthy=false;throw error;}
    }));
    const failure=results.find(result=>result.status==='rejected');
    if(failure)throw failure.reason;
    if(!healthy)throw new Error('Tiến trình đã mất quyền điều khiển chính');
   }
  } catch(error) {
   healthy=false;
   stopHeartbeat();
   if(heartbeatPending)await heartbeatPending.catch(()=>{});
   if(leader){
    recoveryReason=sessionFailure || failureReason(stage,error);
    const session=leader;leader=null;session.release(true);
   }
   logger.error('Tiến trình phun sương tự động không khả dụng; đã tạm dừng điều khiển thiết bị',error,diagnostics(stage));
  } finally {busy=false;}
 }
 return {
  start(){if(timer)return;stopping=false;timer=setInterval(tick,250);timer.unref();void tick();},
  tick,
  async stop(){
   stopping=true;healthy=false;clearInterval(timer);timer=null;
   stopHeartbeat();
   while(busy)await new Promise(resolve=>setTimeout(resolve,25));
   if(heartbeatPending)await heartbeatPending.catch(()=>{});
   if(leader) {
    try {await leader.query('DELETE FROM iot_auto_control_worker');await control.recover('Tắt máy chủ');await leader.query('SELECT pg_advisory_unlock(62003,1)');}
    // Destroy the session even if recovery/unlock fails, releasing its lock.
    finally{leader.release(true);leader=null;healthy=false;}
   }
  },
 };
}
module.exports={...createWorker(),createWorker};
