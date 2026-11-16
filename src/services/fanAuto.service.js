const repository = require('../models/fanAuto.model');
const mqtt = require('./iotMqtt.service');
const AppError = require('../utils/app-error');
const {performance} = require('node:perf_hooks');

const idOf = value => {
 const id = Number(value);
 if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) throw new AppError('Mã tầng không hợp lệ', 400);
 return id;
};
function createService(repo = repository, transport = mqtt,
 command = (...args) => require('./iot.service').control(...args), now = () => Date.now(), env = process.env) {
 const time = () => new Date(now());
 const online = f => transport.isReady() && f.reported_status !== 'offline'
  && f.last_seen_at && now() - new Date(f.last_seen_at).getTime() >= 0
  && now() - new Date(f.last_seen_at).getTime() <= 60000;
 function hardware(f, config) {
  let limits = {};
  try { limits = JSON.parse(env.FAN_AUTO_VERIFIED_WATCHDOGS || '{}'); } catch { /* Not verified. */ }
  const limit = limits?.[`${f.master_identifier}/${f.fan_ssr_channel}`];
  return env.FAN_AUTO_REAL_ENABLED === 'true' && !!config
   && Number.isSafeInteger(limit) && limit <= 86400000 && limit >= config.run_minutes * 60000;
 }
 function mapped(f) {
  if (f.status !== 'ACTIVE' || !f.fan_ssr_channel) throw new AppError('Cần tầng đang hoạt động và đã gán kênh quạt',409);
 }
 function confirmed(feedback, value, requestedAt, fresh=true) {
  const stamp = new Date(feedback?.state_reported_at).getTime();
  return feedback?.reported_state === value && feedback.reported_retained === false
   && feedback.desired_state === value && Number.isFinite(stamp)
   && stamp >= new Date(requestedAt).getTime() && now() >= stamp && (!fresh || now()-stamp <= 60000);
 }
 const locked = (id, work, floorLockHeld=false) => (floorLockHeld ? async (_,fn)=>fn() : repo.lockFloor)(id, async () => {
  const f = await repo.floor(id);
  const config = await repo.get(id);
  return repo.lockChannel(config?.master_id ?? f.master_id, config?.channel ?? f.fan_ssr_channel ?? f.misting_ssr_channel,
   async () => work(f, await repo.get(id)));
 });
 async function off(id, c, after, reason) {
  return repo.set(id, { state:'OFF_PENDING', after_off:after, deadline_at:null,
   requested_at:time(), retry_at:null, last_error:reason || null }, 'OFF_REQUESTED');
 }
 async function finishOff(id, c) {
  if (!c.enabled || c.after_off === 'STOP') return repo.set(id,
   {state:'STOPPED',deadline_at:null,requested_at:null,retry_at:null,last_error:null},'STOPPED');
  const ready = c.after_off === 'RUN';
  return repo.set(id, {state:ready?'READY':'RESTING', deadline_at:ready?null:new Date(now()+c.rest_minutes*60000),
   requested_at:null,retry_at:null,last_error:null}, ready?'OFF_CONFIRMED':'REST_STARTED');
 }
 async function processOff(id, f, c) {
  if (c.dry_run || confirmed(await repo.feedback(c.master_id,c.channel),'OFF',c.requested_at)) return finishOff(id,c);
  if (c.retry_at && now() < new Date(c.retry_at).getTime()) return;
  await repo.set(id,{retry_at:new Date(now()+5000)});
  try {
   // OFF remains allowed without worker leadership, including an explicit Stop.
   await command(f.master_identifier,c.channel,{action:'OFF'},null,{automatic:true,lockHeld:true});
  } catch (error) { await repo.set(id,{last_error:error.message}); }
 }
 const api = {
  candidates:repo.candidates,
  validateStart(f, config, dryRun) {
   if(!config.fan_enabled)return;
   mapped(f);
   if(!dryRun && (!online(f) || !hardware(f,{run_minutes:config.fan_run_minutes})))
    throw new AppError('Quạt chưa trực tuyến hoặc chưa xác minh bộ tự ngắt phù hợp thời gian chạy',409);
  },
  initialRuntime(f, config) {
   return {fan_state:config.fan_enabled?'OFF_PENDING':'STOPPED',fan_after_off:'RUN',
    fan_master_id:config.fan_enabled?f.master_id:null,fan_channel:config.fan_enabled?f.fan_ssr_channel:null,
    fan_requested_at:config.fan_enabled?time():null,fan_deadline_at:null,fan_retry_at:null,fan_last_error:null};
  },
  async status(value) {
   const id=idOf(value),f=await repo.floor(id),c=await repo.get(id);
   const feedback=f.fan_ssr_channel?await repo.feedback(f.master_id,f.fan_ssr_channel):null;
   return {state:c?.state || 'STOPPED',enabled:!!c?.enabled,channel:f.fan_ssr_channel ?? null,
    runMinutes:c?.run_minutes ?? null,restMinutes:c?.rest_minutes ?? null,deadlineAt:c?.deadline_at ?? null,
    remainingMs:Math.max(0,new Date(c?.deadline_at || 0).getTime()-now()),lastError:c?.last_error || null,
    reportedState:feedback?.reported_state || null,reportedAt:feedback?.state_reported_at || null};
  },
  async stop(value, reason, floorLockHeld=false) {
   const id=idOf(value);
   return locked(id,async(f,c)=>{
    if(!c || c.state==='STOPPED')return;
    c=await off(id,c,'STOP',reason);await processOff(id,f,c);
   },floorLockHeld);
  },
  async evaluate(value, canActuate=()=>true) {
   const id=idOf(value);
   return locked(id, async (f,c) => {
    if(!c || (!c.enabled && c.state==='STOPPED')) return;
    if(c.state==='OFF_PENDING') return processOff(id,f,c);
    if(!c.enabled) return off(id,c,'STOP');
    if(!canActuate()) return;
    if(!c.dry_run && (!online(f) || !hardware(f,c))) {
     c=await off(id,c,'REST','Mất kết nối hoặc cấu hình tự ngắt chưa hợp lệ; đang chờ xác nhận quạt tắt');
     return processOff(id,f,c);
    }
    if(c.master_id!==f.master_id || c.channel!==f.fan_ssr_channel || f.status!=='ACTIVE')
     throw new AppError('Thiết bị quạt đã thay đổi; cần kiểm tra cấu hình',409);
    if(c.state==='RUNNING' || c.state==='ON_PENDING') {
     if(now()>=new Date(c.deadline_at).getTime()) {
      c=await off(id,c,'REST');return processOff(id,f,c);
     }
     const feedback=c.dry_run?null:await repo.feedback(c.master_id,c.channel);
     if(c.state==='ON_PENDING') {
      if(c.dry_run || confirmed(feedback,'ON',c.requested_at))
       return repo.set(id,{state:'RUNNING',last_error:null},'ON_CONFIRMED');
      if(now()-new Date(c.requested_at).getTime()>=5000) {
       c=await off(id,c,'REST','Không nhận được phản hồi bật quạt; đang yêu cầu tắt');return processOff(id,f,c);
      }
     } else if(!c.dry_run && !confirmed(feedback,'ON',c.requested_at,false)) {
      c=await off(id,c,'REST','Mất phản hồi quạt đang chạy; đang yêu cầu tắt');return processOff(id,f,c);
     }
     return;
    }
    if(c.state==='RESTING') {
     if(now()>=new Date(c.deadline_at).getTime()) {
      c=await off(id,c,'RUN');return processOff(id,f,c);
     }
     if(!c.dry_run && (await repo.feedback(c.master_id,c.channel))?.reported_state==='ON') {
      c=await off(id,c,'REST','Quạt bật ngoài chu kỳ; đang yêu cầu tắt');return processOff(id,f,c);
     }
     return;
    }
    if(c.state==='READY') {
     if(!c.dry_run && !confirmed(await repo.feedback(c.master_id,c.channel),'OFF',new Date(now()-60000))) {
      c=await off(id,c,'RUN');return processOff(id,f,c);
     }
     const authorize=()=>{if(!canActuate())throw new AppError('Tiến trình AUTO không còn quyền điều khiển',503);};
     authorize();
     const publicationDeadline=performance.now()+c.run_minutes*60000;
     c=await repo.set(id,{state:'ON_PENDING',requested_at:time(),deadline_at:new Date(now()+c.run_minutes*60000),last_error:null},'ON_REQUESTED');
     if(c.dry_run) return;
     try {
      await command(f.master_identifier,c.channel,{action:'ON'},null,{automatic:true,lockHeld:true,
       beforePublish:async()=>{authorize();if(!(await repo.get(id))?.enabled)throw new AppError('AUTO đã dừng',409);return {publicationDeadline};},authorizePublish:authorize});
     } catch(error) {
      c=await off(id,c,'REST',error.message);await processOff(id,f,c);
     }
    }
   });
  },
  async recover(reason='Khôi phục sau gián đoạn') {
   for(const {floor_id:id} of await repo.candidates()) await locked(id,async(f,c)=>{
    if(!c || (!c.enabled && c.state==='STOPPED'))return;
    c=await off(id,c,c.enabled?'REST':'STOP',reason);
    await processOff(id,f,c);
   });
  },
 };
 return api;
}
module.exports={...createService(),createService};
