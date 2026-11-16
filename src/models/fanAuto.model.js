const shared=require('./autoMisting.model');
function createRepository(base=shared) {
 const api={
 floor:base.floor,lockFloor:base.lockFloor,lockChannel:base.lockChannel,
 async get(id) {
  const run=await base.run(id),r=await base.runtime(id),c=run?.config_snapshot;
  if(!c?.fan_enabled && (!r.fan_state || r.fan_state==='STOPPED'))return null;
  return {floor_id:id,enabled:run?.status==='RUNNING' && !!c?.fan_enabled,dry_run:run?.dry_run??true,
   run_minutes:c?.fan_run_minutes,rest_minutes:c?.fan_rest_minutes,state:r.fan_state||'STOPPED',
   after_off:r.fan_after_off,master_id:r.fan_master_id,channel:r.fan_channel,deadline_at:r.fan_deadline_at,
   requested_at:r.fan_requested_at,retry_at:r.fan_retry_at,last_error:r.fan_last_error};
 },
 candidates:()=>base.rows(`SELECT f.floor_id FROM cultivation_floors f LEFT JOIN iot_auto_control_runtime t USING(floor_id)
 WHERE t.fan_state<>'STOPPED' OR EXISTS(SELECT 1 FROM iot_auto_control_runs r WHERE r.floor_id=f.floor_id
 AND r.status='RUNNING' AND r.config_snapshot->>'fan_enabled'='true') ORDER BY f.floor_id`),
 feedback:(master,channel)=>base.one('SELECT * FROM iot_ssr_states WHERE master_id=$1 AND channel=$2',[master,channel]),
 async set(id,values,event) {
  const allowed=['state','after_off','deadline_at','requested_at','retry_at','last_error'];
  if(Object.keys(values).some(k=>!allowed.includes(k)))throw new Error('Unsupported fan runtime field');
  return base.transaction(async()=>{
   await base.runtimeSet(id,Object.fromEntries(Object.entries(values).map(([k,v])=>['fan_'+k,v])));
   if(event)await base.log(id,await base.run(id),'FAN_'+event,values.last_error||null);
   return api.get(id);
  });
 }
 };return api;
}
module.exports={...createRepository(),createRepository};
