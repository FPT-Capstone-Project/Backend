const AppError = require('../utils/app-error');

const ranges = {
 mushroom_type_id: [1, 2147483647], humidity_min: [0,100], humidity_max: [0,100],
 humidity_start_threshold: [0,100], humidity_stop_threshold: [0,100],
 misting_pulse_ms: [1000,60000], cooldown_ms: [1000,86400000], evaluation_interval_ms: [1000,60000],
 sensor_max_age_ms: [1000,300000], required_valid_sensors: [1,3], max_sensor_spread_percent: [0,100],
 max_activations_per_hour: [1,3600], max_cumulative_on_ms_per_hour: [1000,3600000],
};
function validateConfig(input = {}) {
 const c = { sensor_max_age_ms: 20000, required_valid_sensors: 3, ...input };
 const allowed = [...Object.keys(ranges),'profile_name','profile_approved'];
 if (Object.keys(c).some(k => !allowed.includes(k))) throw new AppError('Unknown configuration field; use Start to enter AUTO',400);
 for (const [key,[min,max]] of Object.entries(ranges)) {
  if (typeof c[key] !== 'number' || !Number.isFinite(c[key]) || c[key]<min || c[key]>max
   || (!key.startsWith('humidity_') && key!=='max_sensor_spread_percent' && !Number.isInteger(c[key]))) {
   throw new AppError(`Invalid ${key}: expected ${min}..${max}`,400);
  }
 }
 if (!(c.humidity_min<c.humidity_max && c.humidity_start_threshold<c.humidity_stop_threshold
  && c.humidity_start_threshold<=c.humidity_min && c.humidity_stop_threshold<=c.humidity_max
  && c.max_cumulative_on_ms_per_hour>=c.misting_pulse_ms)) throw new AppError('Inconsistent humidity thresholds or pulse budget',400);
 if (c.profile_name != null && (typeof c.profile_name!=='string' || !c.profile_name.trim() || c.profile_name.length>200)) throw new AppError('Invalid profile_name',400);
 if (c.profile_approved !== undefined && typeof c.profile_approved!=='boolean') throw new AppError('profile_approved must be boolean',400);
 return { ...c, profile_name:c.profile_name || null, profile_approved:c.profile_approved ?? false };
}
function aggregate(rows, c, now = Date.now()) {
 const sensors = [1,2,3].map(id => {
  const row=rows.find(r=>r.sensor_address===id);
  const age=row ? now-new Date(row.last_received_at).getTime() : NaN;
  const valid=!!row && row.is_valid===true && row.retained===false && typeof row.humidity==='number'
   && Number.isFinite(row.humidity) && row.humidity>=0 && row.humidity<=100 && age>=0 && age<=c.sensor_max_age_ms;
  return { sensorId:id, ...row, valid, ageMs:Number.isFinite(age)?age:null };
 });
 const good=sensors.filter(s=>s.valid);
 const averageHumidity=good.length?good.reduce((a,s)=>a+s.humidity,0)/good.length:null;
 const temperatures=good.filter(s=>Number.isFinite(s.temperature));
 const averageTemperature=temperatures.length?temperatures.reduce((a,s)=>a+s.temperature,0)/temperatures.length:null;
 const spread=good.length?Math.max(...good.map(s=>s.humidity))-Math.min(...good.map(s=>s.humidity)):null;
 const reason=good.length<c.required_valid_sensors?'Missing, invalid, retained or stale sensors':spread>c.max_sensor_spread_percent?'Sensor disagreement exceeds configured spread':null;
 return { sensors, averageHumidity, averageTemperature, spread, healthy:!reason, reason };
}
// Demand latches below start; clears at/above stop. While latched, repeat bounded
// pulses after cooldown, including inside the hysteresis band. No continuous ON.
function decide({ running, config:c, runtime:r={}, environment:e, online=true, count=0, duration=0, now=Date.now() }) {
 if (!running) return {action:'NONE',state:'DISABLED',reason:'MANUAL mode'};
 const active=['ON_REQUESTED','MISTING'].includes(r.control_state);
 if (r.control_state==='OFF_PENDING') return {action:'OFF',state:'OFF_PENDING',reason:'OFF confirmation pending'};
 if (active && now>=new Date(r.pulse_deadline_at).getTime()) return {action:'OFF',state:'OFF_PENDING',reason:'Pulse deadline reached'};
 if (!online || !e.healthy) return {action:active?'OFF':'FAULT',state:online?'SENSOR_FAULT':'DEVICE_OFFLINE',reason:online?e.reason:'MQTT or master offline'};
 const demand=e.averageHumidity>=c.humidity_stop_threshold?false:e.averageHumidity<c.humidity_start_threshold?true:!!r.demand;
 if (active) return {action:e.averageHumidity>=c.humidity_max?'OFF':'NONE',state:r.control_state,demand,reason:'Pulse in progress'};
 if (r.cooldown_until && now<new Date(r.cooldown_until).getTime()) return {action:'NONE',state:'COOLDOWN',demand,reason:'Cooldown'};
 if (!demand || e.averageHumidity>=c.humidity_max) return {action:'NONE',state:'IDLE',demand,reason:'Humidity demand cleared'};
 if (count>=c.max_activations_per_hour || duration+c.misting_pulse_ms>c.max_cumulative_on_ms_per_hour) return {action:'NONE',state:'IDLE',demand,reason:'Hourly safety budget exhausted'};
 return {action:'ON',state:'ON_REQUESTED',demand,reason:'Low humidity demand'};
}
module.exports={ranges,validateConfig,aggregate,decide};
