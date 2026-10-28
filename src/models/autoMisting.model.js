const pool = require('../config/db');
const AppError = require('../utils/app-error');
const {AsyncLocalStorage}=require('node:async_hooks');

function createRepository(db = pool) {
 const context=new AsyncLocalStorage();
 const failedClients=new WeakSet();
 const rows = async (sql, values=[]) => (await (context.getStore() || db).query(sql,values)).rows;
 const one = async (sql, values=[]) => (await rows(sql,values))[0];
 async function locked(namespace, id, work) {
  const inherited=context.getStore();
  const client=inherited || await db.connect();
  let broken=false;
  const onError=()=>{broken=true;failedClients.add(client);};
  if(!inherited)client.on?.('error',onError);
  try {
   await client.query('SELECT pg_advisory_lock($1::int,$2::int)',[namespace,id]);
   return await context.run(client,work);
  } finally {
   try { await client.query('SELECT pg_advisory_unlock($1::int,$2::int)',[namespace,id]); }
   catch { broken=true; }
   if(!inherited){client.removeListener?.('error',onError);client.release(broken);}
  }
 }
 const api = {
  rows, one,
  currentConnection:()=>context.getStore(),
  assertLockHealthy:()=>{if(context.getStore() && failedClients.has(context.getStore()))throw new AppError('Mất kết nối cơ sở dữ liệu đang giữ khóa',503);},
  async transaction(work) {
   const existing=context.getStore();
   const client=existing || (db.connect?await db.connect():db);
   try {
    await client.query('BEGIN');
    const result=await context.run(client,work);
    await client.query('COMMIT');return result;
   } catch(error){await client.query('ROLLBACK');throw error;}
   finally{if(!existing && db.connect)client.release();}
  },
  workerReady:async()=>!!await one("SELECT 1 FROM iot_auto_control_worker WHERE id=1 AND heartbeat_at>now()-interval '3 seconds'"),
  lockFloor: (id,work)=>locked(62001,id,work),
  // Shared by ALL manual and automatic command publishers on all instances.
  lockChannel: (master,channel,work)=>locked(62002,master*8+channel,work),
  async floor(id) {
   const f=await one(`SELECT f.*,m.master_identifier,m.reported_status,m.last_seen_at,m.cultivation_room_id
    FROM cultivation_floors f JOIN iot_masters m ON m.id=f.master_id WHERE floor_id=$1`,[id]);
   if (!f) throw new AppError('Không tìm thấy tầng trồng',404);
   return f;
  },
  list:()=>rows('SELECT * FROM cultivation_floors ORDER BY room_id,floor_number'),
  config:id=>one('SELECT * FROM iot_auto_control_configs WHERE floor_id=$1',[id]),
  run:id=>one("SELECT * FROM iot_auto_control_runs WHERE floor_id=$1 ORDER BY id DESC LIMIT 1",[id]),
  runtime:async id=>(await one('SELECT * FROM iot_auto_control_runtime WHERE floor_id=$1',[id])) || {floor_id:id,control_state:'DISABLED'},
  sensors:f=>rows('SELECT * FROM iot_sensor_latest WHERE master_id=$1 AND node_address=$2 ORDER BY sensor_address',[f.master_id,f.node_address]),
  ssr:f=>one('SELECT * FROM iot_ssr_states WHERE master_id=$1 AND channel=$2',[f.master_id,f.misting_ssr_channel]),
  async saveConfig(id,c,user) {
   const keys=Object.keys(c);
   return one(`INSERT INTO iot_auto_control_configs(floor_id,${keys.join(',')},configured_by)
    VALUES($1,${keys.map((_,i)=>`$${i+2}`).join(',')},$${keys.length+2}) ON CONFLICT(floor_id)
    DO UPDATE SET ${keys.map(k=>`${k}=EXCLUDED.${k}`).join(',')},configured_by=EXCLUDED.configured_by,updated_at=now()
    RETURNING *`,[id,...keys.map(k=>k==='source_profiles' && c[k]!=null?JSON.stringify(c[k]):c[k]),user]);
  },
  async runtimeSet(id,values) {
   const keys=Object.keys(values);
   return one(`INSERT INTO iot_auto_control_runtime(floor_id,${keys.join(',')}) VALUES
    ($1,${keys.map((_,i)=>`$${i+2}`).join(',')}) ON CONFLICT(floor_id) DO UPDATE SET
    ${keys.map(k=>`${k}=EXCLUDED.${k}`).join(',')},updated_at=now() RETURNING *`,[id,...Object.values(values)]);
  },
  createRun:(id,c,user,dry)=>one(`INSERT INTO iot_auto_control_runs(floor_id,config_id,config_snapshot,started_by,dry_run,status)
   VALUES($1,$2,$3,$4,$5,'RUNNING') RETURNING *`,[id,c.id,JSON.stringify(c),user,dry]),
  endRun:(id,user,reason,status='STOPPED')=>rows(`UPDATE iot_auto_control_runs SET status=$4,stopped_by=$2,
   stopped_at=now(),stop_reason=$3 WHERE floor_id=$1 AND status='RUNNING' RETURNING *`,[id,user,reason,status]),
  log:(id,run,event,reason,details={})=>one(`INSERT INTO iot_auto_control_logs
   (floor_id,run_id,event_type,reason,average_humidity,sensor_values_json,thresholds_snapshot_json,command_id,reserved_on_ms,average_temperature)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[id,run?.id || null,event,reason,details.averageHumidity??null,
   details.sensors?JSON.stringify(details.sensors):null,run?JSON.stringify(run.config_snapshot):null,details.commandId||null,details.reservedOnMs||0,details.averageTemperature??null]),
  budget:id=>one(`SELECT count(*)::int AS count,COALESCE(sum(reserved_on_ms),0)::int AS duration
   FROM iot_auto_control_logs WHERE floor_id=$1 AND event_type='PULSE_RESERVED'
   AND created_at>now()-interval '1 hour' - interval '60 seconds'`,[id]),
  candidates:()=>rows(`SELECT f.floor_id FROM cultivation_floors f LEFT JOIN iot_auto_control_runtime t USING(floor_id)
   WHERE EXISTS(SELECT 1 FROM iot_auto_control_runs r WHERE r.floor_id=f.floor_id AND r.status='RUNNING')
   OR t.control_state IN ('ON_REQUESTED','MISTING','OFF_PENDING')
   ORDER BY t.pulse_deadline_at NULLS LAST,f.floor_id`),
  async profiles(id) {
   const f=await api.floor(id);
   const profiles=await rows(`SELECT DISTINCT s.mushroom_type_id,c.temperature_min,c.temperature_max,c.humidity_min,c.humidity_max
    FROM cultivation_sessions s JOIN cultivation_trays t ON t.tray_id=s.tray_id
    JOIN rentals r ON r.rental_id=s.rental_id AND r.tray_id=s.tray_id AND r.status='ACTIVE'
    LEFT JOIN mushroom_conditions c ON c.mushroom_type_id=s.mushroom_type_id
    WHERE t.floor_id=$1 AND s.status='ACTIVE'`,[id]);
   const unassigned=await one(`SELECT count(*)::int AS count FROM cultivation_trays WHERE room_id=$1 AND floor_id IS NULL`,[f.room_id]);
   const conflict=['temperature','humidity'].some(k=>{
    const lows=profiles.map(p=>p[`${k}_min`]).filter(v=>v!=null).map(Number);
    const highs=profiles.map(p=>p[`${k}_max`]).filter(v=>v!=null).map(Number);
    return lows.length && highs.length && Math.max(...lows)>Math.min(...highs);
   });
   const trays=await rows(`SELECT t.tray_id,t.tray_code,t.status AS tray_status,
    s.session_id,s.rental_id,s.mushroom_type_id,s.status AS cultivation_status,m.name AS mushroom_name
    FROM cultivation_trays t LEFT JOIN (
     cultivation_sessions s JOIN rentals r ON r.rental_id=s.rental_id
      AND r.tray_id=s.tray_id AND r.status='ACTIVE'
    ) ON s.tray_id=t.tray_id AND s.status='ACTIVE'
    LEFT JOIN mushroom_types m ON m.mushroom_type_id=s.mushroom_type_id
    WHERE t.floor_id=$1 ORDER BY t.tray_id,s.session_id`,[id]);
   return {profiles,trays,conflict,unassignedTrays:unassigned.count,requiresApproval:profiles.length>1 || conflict || unassigned.count>0};
  },
  async acquireLeader() {
   const client=await db.connect();
   let result;
   try {result=await client.query('SELECT pg_try_advisory_lock(62003,1) AS acquired');}
   catch(error) {client.release(true);throw error;}
   if (!result.rows[0].acquired) {client.release();return null;}
   return client;
  },
 };
 return api;
}
module.exports={...createRepository(),createRepository};
