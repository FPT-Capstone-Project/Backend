const repository=require('../models/autoMisting.model');
const service=require('./autoMisting.service');
const {randomUUID}=require('node:crypto');

// A dedicated session elects one worker. Losing that session closes the local
// actuation gate; a replacement reconciles OFF before allowing new pulses.
function createWorker(repo=repository,control=service,logger=console) {
 let timer,leader,busy=false,stopping=false,healthy=false;
 const workerId=randomUUID();
 let recoveryReason='Tiến trình lần đầu nhận quyền điều khiển chính (khởi động hoặc tiếp quản)';
 let sessionFailure;
 const diagnostics=stage=>({workerId,pid:process.pid,uptimeSeconds:Math.floor(process.uptime()),stage,at:new Date().toISOString()});
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
    logger.info?.('Đã nhận quyền điều khiển phun sương chính; đang xác nhận trạng thái tắt (OFF) và giữ chế độ tự động (AUTO)',{...diagnostics(stage),reason:recoveryReason});
    await control.recover(recoveryReason);
   }
   stage='kiểm tra hoạt động của tiến trình điều khiển chính';
   await leader.query('SELECT 1');
   if(!healthy)throw new Error('Tiến trình đã mất quyền điều khiển chính');
   stage='cập nhật tín hiệu hoạt động';
   await leader.query(`INSERT INTO iot_auto_control_worker(id,heartbeat_at) VALUES(1,now())
    ON CONFLICT(id) DO UPDATE SET heartbeat_at=now()`);
   let floors;
   try {floors=await repo.candidates();}
   catch(error) {
    // This query uses the pool, not the session holding the leader lock.
    // Retry next tick without triggering takeover recovery for unrelated errors.
    logger.error('Không thể truy vấn các tầng cần điều khiển phun sương; sẽ thử lại ở chu kỳ tiếp theo',error,diagnostics('truy vấn các tầng cần điều khiển'));
    return;
   }
   // Bounded parallelism keeps one delayed device from blocking every floor.
   for(let i=0;i<floors.length;i+=2) {
    await Promise.all(floors.slice(i,i+2).map(async f=>{
     try {await control.evaluate(f.floor_id,false,()=>healthy && !stopping);}
     catch(error) {logger.error(`Không thể đánh giá phun sương tự động cho tầng ${f.floor_id}`,error);}
    }));
   }
  } catch(error) {
   healthy=false;
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
   while(busy)await new Promise(resolve=>setTimeout(resolve,25));
   if(leader) {
    try {await leader.query('DELETE FROM iot_auto_control_worker');await control.recover('Tắt máy chủ');await leader.query('SELECT pg_advisory_unlock(62003,1)');}
    // Destroy the session even if recovery/unlock fails, releasing its lock.
    finally{leader.release(true);leader=null;healthy=false;}
   }
  },
 };
}
module.exports={...createWorker(),createWorker};
