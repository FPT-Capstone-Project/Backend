const repository = require('../models/autoMisting.model');
const mqtt = require('./iotMqtt.service');
const AppError = require('../utils/app-error');
const {randomUUID}=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {validateConfig,aggregate,decide}=require('./autoMisting.algorithm');
const {suggest,assertCompatible}=require('./autoMisting.profile');

function positive(value,name='floorId') {
 if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value)<1 || Number(value)>2147483647) throw new AppError(`${name} không hợp lệ`,400);
 return Number(value);
}
function createService(repo=repository, publisher=mqtt, command=(...args)=>require('./iot.service').control(...args), now=()=>Date.now(), wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
 const online=f=>publisher.isReady() && f.reported_status!=='offline';
 function retryable(reason,state,environment) {
  const error=new AppError(reason,409);
  error.retryState=state;error.environment=environment;
  return error;
 }
 function watchdog(f) {
  let verified={};
  try { verified=JSON.parse(process.env.AUTO_MISTING_VERIFIED_WATCHDOGS || '{}'); } catch { /* Fail closed. */ }
  const limit=verified[f.master_identifier];
  return Number.isInteger(limit) && limit>=1000 && limit<=60000?limit:0;
 }
 function hardware(f,c) {
  return process.env.AUTO_MISTING_REAL_ENABLED==='true' && watchdog(f)>=c.misting_pulse_ms;
 }
 async function hasLiveOff(f,c) {
  const ssr=await repo.ssr(f);
  const age=ssr?.state_reported_at?now()-new Date(ssr.state_reported_at):NaN;
  return ssr?.reported_state==='OFF' && ssr.reported_retained===false && Number.isFinite(age) && age>=0
   && age<=c.sensor_max_age_ms && ssr.desired_state!=='ON';
 }
 async function requireLiveOff(f,c) {
  if(!await hasLiveOff(f,c))throw retryable('Đang chờ phản hồi trực tiếp mới xác nhận SSR đã tắt (OFF)','OFF_PENDING');
 }
 async function prepareStartOff(f,c,user,starting=true) {
  const previous=await repo.ssr(f);
  let requestedAt=now();
  await command(f.master_identifier,f.misting_ssr_channel,{action:'OFF'},user,{
   automatic:true,lockHeld:true,beforePublish:()=>{requestedAt=now();}
  });
  // Publication acknowledgement is not device feedback. Keep the channel locked
  // until a new live OFF arrives, so another publisher cannot turn it on here.
  for(let elapsed=0;elapsed<=5000;elapsed+=100) {
   const ssr=await repo.ssr(f);
   const reportedAt=ssr?.state_reported_at?new Date(ssr.state_reported_at).getTime():NaN;
   const age=now()-reportedAt;
   if(ssr?.reported_state==='OFF' && ssr.reported_retained===false && ssr.desired_state!=='ON'
    && reportedAt>=requestedAt && (!previous?.state_reported_at || reportedAt>new Date(previous.state_reported_at).getTime())
    && age>=0 && age<=c.sensor_max_age_ms)return;
   if(elapsed<5000)await wait(100);
  }
  throw new AppError(starting?'Đã hủy khởi động: thiết bị không gửi phản hồi trực tiếp mới xác nhận SSR đã tắt (OFF) trong 5 giây; chưa bật chế độ tự động (AUTO)':
   'Đã hủy đợt phun sương: thiết bị không gửi phản hồi trực tiếp mới xác nhận SSR đã tắt (OFF) trong 5 giây',504);
 }
 async function editable(id) {
  const run=await repo.run(id); const rt=await repo.runtime(id);
  if (run?.status==='RUNNING' || ['ON_REQUESTED','MISTING','OFF_PENDING'].includes(rt.control_state)) throw new AppError('Dừng chế độ tự động và hoàn tất xác nhận tắt (OFF) trước khi thay đổi cấu hình hoặc gán thiết bị',409);
 }
 async function env(id,c) {const f=await repo.floor(id);return {masterId:f.master_identifier,nodeId:f.node_address,thresholds:c,...aggregate(await repo.sensors(f),c,now())};}
 async function verifyProfile(id,c) {
  if(c.config_source==='FLOOR')assertCompatible(c,(await repo.profiles(id)).profiles,true);
 }
 async function log(id,run,event,reason,details) {return repo.log(id,run,event,reason,details);}
 async function stopRecord(id,user,reason,status='STOPPED') {
  return repo.transaction(async()=>{
  await repo.endRun(id,user,reason,status);
  const rt=await repo.runtime(id);
  const active=['ON_REQUESTED','MISTING','OFF_PENDING'].includes(rt.control_state);
  await repo.runtimeSet(id,{control_state:active?'OFF_PENDING':'DISABLED',last_error:status==='FAULT'?reason:null});
  return active;
  });
 }
 async function requestOff(f,run,reason) {
  return repo.lockChannel(f.master_id,f.misting_ssr_channel,()=>requestOffLocked(f,run,reason));
 }
 async function requestOffLocked(f,run,reason) {
  const id=f.floor_id, c=run.config_snapshot;
  const rt=await repo.runtime(id);
  // An OFF state must be live and newer than the first OFF request. Publication
  // success alone is never treated as device acknowledgement.
  const ssr=await repo.ssr(f);
  const feedbackAge=ssr?.state_reported_at?now()-new Date(ssr.state_reported_at):NaN;
  const confirmed=run.dry_run || (rt.off_requested_at && ssr?.reported_state==='OFF' && ssr.reported_retained===false
   && ssr.desired_state!=='ON' && Number.isFinite(feedbackAge) && feedbackAge>=0 && feedbackAge<=c.sensor_max_age_ms
   && new Date(ssr.state_reported_at)>=new Date(rt.off_requested_at));
  if (confirmed) {
   const latest=await repo.run(id);
   await repo.runtimeSet(id,{control_state:latest?.status==='RUNNING'?'COOLDOWN':'DISABLED',
    cooldown_until:new Date(now()+c.cooldown_ms),pulse_deadline_at:null,off_requested_at:null,last_error:null});
   await log(id,run,'OFF_CONFIRMED',run.dry_run?'Đã mô phỏng tắt (OFF)': 'Đã nhận phản hồi trực tiếp báo tắt (OFF); chưa xác minh dòng nước thực tế');
   return;
  }
  if (rt.off_requested_at && now()-new Date(rt.updated_at).getTime()<2000) return;
  await repo.runtimeSet(id,{control_state:'OFF_PENDING',off_requested_at:rt.off_requested_at || new Date(now()),last_error:'Đang chờ phản hồi trực tiếp xác nhận tắt (OFF)'});
  try {
   const result=await command(f.master_identifier,f.misting_ssr_channel,{action:'OFF'},null,{automatic:true,lockHeld:true});
   await log(id,run,'OFF_REQUESTED',reason,{commandId:result.commandId});
  } catch(error) {
   await repo.runtimeSet(id,{control_state:'OFF_PENDING',last_error:error.message});
   await log(id,run,'OFF_FAILED',error.message);
  }
 }
 // Caller holds both locks. An interrupted run must never resume automatically.
 async function reconcileInterruption(f,run,reason) {
  const id=f.floor_id;
  await repo.transaction(async()=>{
   if(run.status==='RUNNING')await repo.endRun(id,null,reason,'FAULT');
   await repo.runtimeSet(id,{run_id:run.id,control_state:'OFF_PENDING',
    cycle_id:null,pulse_started_at:null,pulse_deadline_at:null,off_requested_at:null,
    demand:false,cooling_demand:false,last_evaluated_at:null,last_reason:reason,
    last_error:'Đang chờ phản hồi trực tiếp xác nhận tắt (OFF) sau khi tiến trình bị gián đoạn'});
   await log(id,run,'INTERRUPTION_STOP',reason);
  });
  await requestOffLocked(f,run,reason);
 }
 const api={
  list:()=>repo.list(),
  async environment(value) {const id=positive(value);return env(id,await repo.config(id) || {sensor_max_age_ms:20000,required_valid_sensors:3,max_sensor_spread_percent:100});},
  async configuration(value) {
   const id=positive(value);await repo.floor(id);
   const config=await repo.config(id),run=await repo.run(id);
   const cultivation=await repo.profiles(id);
   return {config,mode:run?.status==='RUNNING'?'AUTO':'MANUAL',cultivation,
    suggestions:config?await repo.one('SELECT * FROM mushroom_conditions WHERE mushroom_type_id=$1',[config.mushroom_type_id]):null,
    floorSuggestion:suggest(cultivation.profiles)};
  },
  async suggestions(value) {
   const id=positive(value);await repo.floor(id);
   return suggest((await repo.profiles(id)).profiles);
  },
  async save(value,body,user) {
   const id=positive(value),c=validateConfig(body);
   return repo.lockFloor(id,async()=>{await repo.floor(id);await editable(id);
    c.config_source=c.config_source || 'LEGACY';
    c.cooling_enabled=c.cooling_enabled ?? false;
    c.source_profiles=null;
    if(c.config_source==='FLOOR') {
     if(!c.profile_approved || !c.profile_name)throw new AppError('Kiểm tra, đặt tên và phê duyệt cấu hình tầng trước khi lưu',409);
     c.source_profiles=assertCompatible(c,(await repo.profiles(id)).profiles);
     c.mushroom_type_id=null;
    }
    return repo.transaction(async()=>{const config=await repo.saveConfig(id,c,user);await log(id,null,'CONFIG_SAVED','Đã lưu cấu hình; vẫn duy trì chế độ thủ công (MANUAL)');return {config,mode:'MANUAL'};});
   });
  },
  async map(value,body) {
   const allowed=['room_id','floor_number','floor_name','master_id','node_address','misting_ssr_channel','status','total_rows','total_columns'];
   if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>!allowed.includes(k))) throw new AppError('Trường gán thiết bị không được hỗ trợ',400);
   const data={...body,status:body.status || 'ACTIVE'};
   for(const k of ['room_id','floor_number','master_id','node_address','misting_ssr_channel']) data[k]=positive(data[k],k);
   if(data.node_address>247 || data.misting_ssr_channel>8 || typeof data.floor_name!=='string' || !data.floor_name.trim() || data.floor_name.length>200 || !['ACTIVE','INACTIVE'].includes(data.status)) throw new AppError('Thông tin gán thiết bị cho tầng không hợp lệ',400);
   for(const k of ['total_rows','total_columns'])if(data[k]!=null) {
    data[k]=positive(data[k],k);
    if(data[k]>32767)throw new AppError(`${k} không được vượt quá 32767`,400);
   }
   const write=async id=>{
    try {
    const keys=allowed.filter(k=>Object.hasOwn(data,k));
    if(id && (data.total_rows!=null || data.total_columns!=null)) {
     const outside=await repo.one(`SELECT 1 FROM tray_positions WHERE floor_id=$1
      AND (row_number>$2 OR column_number>$3) LIMIT 1`,[id,data.total_rows??null,data.total_columns??null]);
     if(outside)throw new AppError('Kích thước tầng nhỏ hơn các vị trí khay đã khai báo',409);
    }
    if(id) {await editable(id);return await repo.one(`UPDATE cultivation_floors SET ${keys.map((k,i)=>`${k}=$${i+2}`).join(',')},updated_at=now() WHERE floor_id=$1 RETURNING *`,[id,...keys.map(k=>data[k])]);}
    return await repo.one(`INSERT INTO cultivation_floors(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING *`,keys.map(k=>data[k]));
    } catch(error) {
     if(error.constraint==='light_mapping_conflict')throw new AppError(error.message,409);
     throw error;
    }
   };
   if(!value)return write(null);
   const id=positive(value);return repo.lockFloor(id,async()=>{const f=await repo.floor(id);return repo.lockChannel(f.master_id,f.misting_ssr_channel,()=>write(id));});
  },
  async assignTray(value,trayValue,body={}) {
   const id=positive(value),tray=positive(trayValue,'trayId');
   if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k=>k!=='position_id'))throw new AppError('Chỉ hỗ trợ position_id khi gán vị trí khay',400);
   const hasPosition=Object.hasOwn(body,'position_id');
   const positionId=hasPosition && body.position_id!==null?positive(body.position_id,'position_id'):null;
   return repo.lockFloor(id,async()=>{await editable(id);const f=await repo.floor(id);
    return repo.transaction(async()=>{
    const found=await repo.one('SELECT * FROM cultivation_trays WHERE tray_id=$1 FOR UPDATE',[tray]);
    if(!found || found.room_id!==f.room_id)throw new AppError('Khay phải tồn tại trong phòng chứa tầng này',400);
    if(found.floor_id && found.floor_id!==id)throw new AppError('Cần gỡ liên kết khay bằng quy trình bảo trì cơ sở dữ liệu đã được kiểm tra trước khi chuyển tầng',409);
    const targetPosition=hasPosition?positionId:found.position_id;
    if(targetPosition!=null) {
     const position=await repo.one('SELECT * FROM tray_positions WHERE position_id=$1 FOR UPDATE',[targetPosition]);
     if(!position || position.floor_id!==id || position.room_id!==f.room_id)throw new AppError('Vị trí khay phải thuộc đúng tầng và phòng',400);
     if(position.status!=='ACTIVE')throw new AppError('Vị trí khay không hoạt động',409);
     if((f.total_rows!=null && position.row_number>f.total_rows) || (f.total_columns!=null && position.column_number>f.total_columns))throw new AppError('Vị trí khay vượt kích thước tầng',409);
     if(await repo.one('SELECT 1 FROM cultivation_trays WHERE position_id=$1 AND tray_id<>$2',[targetPosition,tray]))throw new AppError('Vị trí này đã có khay',409);
    }
    return repo.one('UPDATE cultivation_trays SET floor_id=$1,position_id=$3,updated_at=now() WHERE tray_id=$2 RETURNING *',[id,tray,targetPosition??null]);
    });
   });
  },
  async start(value,body={},user) {
   const id=positive(value);
   if(Object.keys(body).some(k=>k!=='dryRun') || (body.dryRun!==undefined && typeof body.dryRun!=='boolean'))throw new AppError('dryRun phải là true hoặc false',400);
   const dry=body.dryRun ?? true;
   return repo.lockFloor(id,async()=>{
    const f=await repo.floor(id);
    return repo.lockChannel(f.master_id,f.misting_ssr_channel,async()=>{
     await editable(id);
     if(!await repo.workerReady())throw new AppError('Tiến trình điều khiển tự động chưa sẵn sàng',503);
     const c=await repo.config(id);if(!c)throw new AppError('Hãy lưu cấu hình trước',409);
     if(f.status!=='ACTIVE' || f.room_id!==f.cultivation_room_id)throw new AppError('Thông tin gán thiết bị cho tầng không hợp lệ hoặc tầng không hoạt động',409);
     const cultivation=await repo.profiles(id);
     if(c.config_source==='FLOOR') {
      assertCompatible(c,cultivation.profiles,true);
      if(!c.profile_approved || !c.profile_name)throw new AppError('Cần có cấu hình tầng đã đặt tên và được phê duyệt',409);
     } else if((cultivation.requiresApproval || cultivation.profiles.some(p=>p.mushroom_type_id!==c.mushroom_type_id)) && !(c.profile_approved && c.profile_name))throw new AppError('Các khay có cấu hình khác nhau hoặc chưa được gán cần có cấu hình tầng đã đặt tên và được phê duyệt rõ ràng',409);
     const e=await env(id,c);if(!e.healthy)throw new AppError(e.reason,409);
     if(!dry) {
      if(!hardware(f,c))throw new AppError('Chưa cho phép điều khiển tự động thiết bị thực: cần xác minh bộ giám sát an toàn (watchdog) của thiết bị',409);
      if(!online(f))throw new AppError('MQTT hoặc bộ điều khiển trung tâm mất kết nối',503);
      await prepareStartOff(f,c,user);
      // Device feedback may take several seconds; recheck prerequisites before
      // creating a running session.
      if(!await repo.workerReady())throw new AppError('Tiến trình điều khiển tự động chưa sẵn sàng',503);
      if(!online(await repo.floor(id)))throw new AppError('MQTT hoặc bộ điều khiển trung tâm mất kết nối',503);
      const fresh=await env(id,c);if(!fresh.healthy)throw new AppError(fresh.reason,409);
      await verifyProfile(id,c);
     }
     return repo.transaction(async()=>{
     const run=await repo.createRun(id,c,user,dry);
     await repo.runtimeSet(id,{run_id:run.id,control_state:'IDLE',demand:false,cooling_demand:false,last_reason:null,cycle_id:null,pulse_started_at:null,pulse_deadline_at:null,cooldown_until:null,off_requested_at:null,last_error:null,last_evaluated_at:null});
     await log(id,run,'START',dry?'Người vận hành đã bắt đầu chạy mô phỏng':'Người vận hành đã chủ động bật chế độ tự động điều khiển thiết bị thực');
     return {mode:'AUTO',run};
     });
    });
   });
  },
  async stop(value,user,reason='Người vận hành yêu cầu dừng') {
   const id=positive(value);
   return repo.lockFloor(id,async()=>{
    const f=await repo.floor(id),run=await repo.run(id);
    await repo.lockChannel(f.master_id,f.misting_ssr_channel,()=>stopRecord(id,user,reason));
    if(run) {await log(id,run,'STOP',reason);if((await repo.runtime(id)).control_state==='OFF_PENDING')await requestOff(f,run,reason);}
    return api.status(id);
   });
  },
  // Called by the existing manual command service INSIDE its channel lock.
  async manual(master,channel,action,user) {
   const f=await repo.one('SELECT * FROM cultivation_floors WHERE master_id=$1 AND misting_ssr_channel=$2',[master,channel]);
   if(!f)return;
   const run=await repo.run(f.floor_id),rt=await repo.runtime(f.floor_id);
   const owned=run?.status==='RUNNING' || ['ON_REQUESTED','MISTING','OFF_PENDING'].includes(rt.control_state);
   if(!owned)return;
   if(action==='ON')throw new AppError('Chế độ tự động (AUTO) đang quản lý kênh này; hãy dừng và xác nhận tắt (OFF) trước khi bật (ON) thủ công',409);
   const allowed=await repo.one(`SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_id=u.role_id
    JOIN permissions p USING(permission_id) WHERE u.user_id=$1 AND p.permission_name='iot.automation.manage'`,[user]);
   if(!allowed)throw new AppError('Cần quyền quản lý tự động hóa để can thiệp điều khiển',403);
   await stopRecord(f.floor_id,user,'Người vận hành can thiệp bằng lệnh tắt (OFF) thủ công');
   await log(f.floor_id,run,'MANUAL_OVERRIDE','Lệnh tắt (OFF) thủ công đã dừng chế độ tự động');
  },
  async status(value) {
   const id=positive(value),f=await repo.floor(id),run=await repo.run(id),runtime=await repo.runtime(id);
   return {mode:run?.status==='RUNNING'?'AUTO':'MANUAL',run:run || null,runtime,
    environment:await api.environment(id),ssr:await repo.ssr(f) || null,
    cooldownRemainingMs:Math.max(0,new Date(runtime.cooldown_until || 0).getTime()-now()),
    lastDecision:await repo.one('SELECT * FROM iot_auto_control_logs WHERE floor_id=$1 ORDER BY id DESC LIMIT 1',[id]) || null};
  },
  async logs(value,query={}) {
   const id=positive(value);await repo.floor(id);
   const limit=positive(query.limit??100,'limit'),offset=Number(query.offset??0);
   if(limit>1000 || !Number.isInteger(offset) || offset<0 || offset>1000000)throw new AppError('Thông tin phân trang không hợp lệ',400);
   return {limit,offset,logs:await repo.rows('SELECT * FROM iot_auto_control_logs WHERE floor_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[id,limit,offset])};
  },
  async evaluate(value,preview=false,canActuate=()=>true) {
   const id=positive(value);
   return repo.lockFloor(id,async()=>{
    const f=await repo.floor(id),run=await repo.run(id),rt=await repo.runtime(id),c=run?.status==='RUNNING'?run.config_snapshot:await repo.config(id);
    if(!c)throw new AppError('Hãy lưu cấu hình trước',409);
    // Connection failures bypass the normal evaluation interval and pulse deadline.
    if(!preview && run?.status==='RUNNING' && (!canActuate() || (!run.dry_run && !online(f)))) {
     const reason='Mất kết nối hoặc quyền điều khiển; AUTO đã dừng, cần bấm Start lại';
     await repo.lockChannel(f.master_id,f.misting_ssr_channel,()=>reconcileInterruption(f,run,reason));
     return {action:'OFF',state:(await repo.runtime(id)).control_state,reason};
    }
    if(!preview && run?.status==='RUNNING' && !['ON_REQUESTED','MISTING','OFF_PENDING'].includes(rt.control_state)
     && rt.last_evaluated_at && now()-new Date(rt.last_evaluated_at)<c.evaluation_interval_ms)
     return {action:'NONE',state:rt.control_state,reason:'Đang chờ đến chu kỳ đánh giá tiếp theo'};
    const e=await env(id,c),budget=await repo.budget(id);
    const reservedOnMs=run?.dry_run?c.misting_pulse_ms:Math.max(c.misting_pulse_ms,watchdog(f));
    const decision=decide({running:run?.status==='RUNNING',config:c,runtime:rt,environment:e,online:run?.dry_run || online(f),
     ...budget,duration:budget.duration+reservedOnMs-c.misting_pulse_ms,now:now()});
    if(preview) {
     if(run?.status==='RUNNING')await verifyProfile(id,c);
     return {dryRun:true,decision,environment:e};
    }
    if(rt.control_state==='OFF_PENDING' && run) {await requestOff(f,run,'Xác nhận lại lệnh tắt (OFF) đang chờ');return decision;}
    if(run?.status!=='RUNNING')return decision;
    const active=['ON_REQUESTED','MISTING'].includes(rt.control_state);
    try {
     if(f.status!=='ACTIVE' || f.room_id!==f.cultivation_room_id)throw new AppError('Thông tin gán thiết bị cho tầng không hợp lệ hoặc tầng không hoạt động',409);
     await verifyProfile(id,c);
    } catch(error) {
     await stopRecord(id,null,error.message,'FAULT');
     await log(id,run,'FAULT',error.message,e);
     if(active)await requestOff(f,run,error.message);
     return {action:active?'OFF':'FAULT',state:active?'OFF_PENDING':'DISABLED',reason:error.message};
    }
    if(!active && rt.last_evaluated_at && now()-new Date(rt.last_evaluated_at)<c.evaluation_interval_ms)return decision;
    if(!run.dry_run && !hardware(f,c)) {await stopRecord(id,null,'Thiết bị chưa được xác minh an toàn','FAULT');if(active)await requestOff(f,run,'Đã chặn điều khiển thiết bị để bảo đảm an toàn');return;}
    if(['SENSOR_FAULT','DEVICE_OFFLINE'].includes(decision.state)) {
     await stopRecord(id,null,decision.reason,'FAULT');
     await log(id,run,'FAULT',decision.reason,e);
     await repo.runtimeSet(id,{control_state:active?'OFF_PENDING':decision.state,last_error:decision.reason,
      last_reason:decision.reason,last_evaluated_at:new Date(now())});
     if(active)await requestOff(f,run,decision.reason);
     return {...decision,action:active?'OFF':'FAULT',state:active?'OFF_PENDING':decision.state};
    }
    if(decision.action==='OFF') {
     if(decision.demand!==undefined)await repo.runtimeSet(id,{demand:decision.demand,cooling_demand:decision.coolingDemand??false,last_reason:decision.reason});
     await requestOff(f,run,decision.reason);return decision;
    }
    if(decision.action==='FAULT')return decision;
    if(decision.action==='ON') {
     const reserve=async()=>{
      if(!canActuate())throw new AppError('Tiến trình không còn quyền điều khiển chính',409);
      const current=await repo.run(id);
      if(current?.id!==run.id || current.status!=='RUNNING')throw new AppError('Phiên chạy đã dừng trước khi gửi lệnh bật (ON)',409);
      const fresh=await env(id,c);
      if(!fresh.healthy)throw retryable(fresh.reason,'SENSOR_FAULT',fresh);
      if(!run.dry_run && !online(await repo.floor(id)))throw retryable('MQTT hoặc bộ điều khiển trung tâm mất kết nối trước khi gửi lệnh','DEVICE_OFFLINE',fresh);
      await verifyProfile(id,c);
      const latestDecision=decide({running:true,config:c,runtime:rt,environment:fresh,
       ...budget,duration:budget.duration+reservedOnMs-c.misting_pulse_ms,now:now()});
      if(latestDecision.action!=='ON') {
       const error=retryable(latestDecision.reason,latestDecision.state,fresh);
       error.decision=latestDecision;throw error;
      }
      Object.assign(decision,latestDecision);
      if(!run.dry_run)await requireLiveOff(f,c);
      let publicationDeadline;
      await repo.transaction(async()=>{
      publicationDeadline=performance.now()+c.misting_pulse_ms;
      await repo.runtimeSet(id,{control_state:'ON_REQUESTED',cycle_id:randomUUID(),demand:decision.demand,
       cooling_demand:decision.coolingDemand??false,last_reason:decision.reason,
       pulse_started_at:new Date(now()),pulse_deadline_at:new Date(now()+c.misting_pulse_ms),off_requested_at:null});
      await log(id,run,'PULSE_RESERVED',decision.reason,{...fresh,reservedOnMs});
      });
      return {publicationDeadline};
     };
     try {
      let result;
      if(!run.dry_run) {
       // Renew stale/retained feedback before entering the ON command service:
       // nesting OFF inside its beforePublish hook would conflict with activeChannels.
       await repo.lockChannel(f.master_id,f.misting_ssr_channel,async()=>{
        const current=await repo.run(id);
        if(!canActuate() || current?.id!==run.id || current.status!=='RUNNING')throw new AppError('Phiên chạy đã dừng hoặc tiến trình mất quyền điều khiển chính trước khi xác nhận lại trạng thái tắt (OFF)',409);
        if(!await hasLiveOff(f,c)) {
         try {await prepareStartOff(f,c,null,false);}
         catch(error) {
          if([503,504].includes(error.statusCode))error.retryState='OFF_PENDING';
          throw error;
         }
        }
       });
       // reserve rechecks run, sensors, profile, connection, demand and OFF after
       // the wait and after reacquiring the channel lock for ON.
      }
      if(run.dry_run)await repo.lockChannel(f.master_id,f.misting_ssr_channel,reserve);
      else result=await command(f.master_identifier,f.misting_ssr_channel,{action:'ON'},null,{automatic:true,beforePublish:reserve,
       authorizePublish:()=>{if(!canActuate())throw new AppError('Tiến trình mất quyền điều khiển chính trước khi gửi lệnh',409);},
       maxPublishMs:Math.min(5000,c.misting_pulse_ms)});
      await repo.lockChannel(f.master_id,f.misting_ssr_channel,async()=>{
       if((await repo.run(id))?.status==='RUNNING')await repo.runtimeSet(id,{control_state:'MISTING',last_error:null});
      });
      await log(id,run,'ON_REQUESTED',run.dry_run?'Đã mô phỏng đợt phun sương; không gửi lệnh MQTT':'Đã gửi lệnh bật (ON); chưa xác minh trạng thái van thực tế',{commandId:result?.commandId});
     } catch(error) {
      if(!canActuate()) {
       // Shutdown or loss of leadership can interrupt ON preparation/publication.
       // End interrupted runs; manual Stop/FAULT still wins.
       await repo.lockChannel(f.master_id,f.misting_ssr_channel,async()=>{
        const current=await repo.run(id);
        if(current?.id===run.id && current.status==='RUNNING')
         await reconcileInterruption(f,current,'Tiến trình bị gián đoạn khi thực hiện lệnh bật (ON)');
       });
       return {action:'OFF',state:(await repo.runtime(id)).control_state,reason:'Tiến trình bị gián đoạn khi thực hiện lệnh bật (ON)'};
      }
      const current=await repo.run(id),latest=await repo.runtime(id);
      if(current?.id===run.id && current.status==='RUNNING'
       && (error.retryState==='DEVICE_OFFLINE' || [503,504].includes(error.statusCode))) {
       await repo.lockChannel(f.master_id,f.misting_ssr_channel,()=>reconcileInterruption(f,current,error.message));
       return {action:'OFF',state:(await repo.runtime(id)).control_state,reason:error.message};
      }
      if(current?.id===run.id && current.status==='RUNNING' && canActuate()
       && error.decision) {
       // Publication may have reached the device. Never retry ON until a new
       // live OFF has been confirmed, followed by the normal cooldown/budget.
       const needsOff=['ON_REQUESTED','MISTING','OFF_PENDING'].includes(latest.control_state) || error.retryState==='OFF_PENDING';
       const state=needsOff?'OFF_PENDING':error.retryState || 'DEVICE_OFFLINE';
       await repo.runtimeSet(id,{control_state:state,last_error:error.decision?null:error.message,last_reason:error.message,
        demand:error.decision?.demand??latest.demand,cooling_demand:error.decision?.coolingDemand??latest.cooling_demand,
        last_evaluated_at:new Date(now())});
       await log(id,run,error.decision?'DECISION':'RETRY_WAIT',error.message,error.environment || e);
       if(needsOff)await requestOff(f,run,error.message);
       return {action:needsOff?'OFF':'NONE',state,reason:error.message};
      }
      const needsOff=await stopRecord(id,null,error.message,'FAULT');
      await log(id,run,'FAULT',error.message);
      if(needsOff)await requestOff(f,run,'Thực hiện lệnh bật (ON) thất bại hoặc các điều kiện cần thiết đã thay đổi');
     }
    } else if(rt.control_state!==decision.state || rt.demand!==decision.demand
     || rt.cooling_demand!==decision.coolingDemand || rt.last_reason!==decision.reason) {
     await repo.lockChannel(f.master_id,f.misting_ssr_channel,async()=>{
      if((await repo.run(id))?.status!=='RUNNING')return;
      await repo.runtimeSet(id,{control_state:decision.state,demand:decision.demand??rt.demand,
       cooling_demand:decision.coolingDemand??rt.cooling_demand,last_reason:decision.reason,last_error:null});
      await log(id,run,'DECISION',decision.reason,e);
     });
    }
    if(!active)await repo.runtimeSet(id,{last_evaluated_at:new Date(now()),last_average_humidity:e.averageHumidity,last_average_temperature:e.averageTemperature});
    return decision;
   });
  },
  async recover(reason='Tiến trình khởi động lại hoặc chuyển giao quyền điều khiển chính') {
   for(const {floor_id:id} of await repo.candidates())await repo.lockFloor(id,async()=>{
    const f=await repo.floor(id);
    await repo.lockChannel(f.master_id,f.misting_ssr_channel,async()=>{
     // Re-read under both locks: an operator may have stopped the floor while
     // this recovery was waiting. Never reactivate STOPPED or FAULT runs.
     const run=await repo.run(id),rt=await repo.runtime(id);
     if(!run || (run.status!=='RUNNING' && !['ON_REQUESTED','MISTING','OFF_PENDING'].includes(rt.control_state)))return;
     await reconcileInterruption(f,run,reason);
    });
   });
  },
 };
 return api;
}
module.exports={...createService(),createService,positive};
