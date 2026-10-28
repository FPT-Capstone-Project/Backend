const AppError = require('../utils/app-error');

const ranges = {
 mushroom_type_id: [1, 2147483647], humidity_min: [0,100], humidity_max: [0,100],
 humidity_start_threshold: [0,100], humidity_stop_threshold: [0,100],
 misting_pulse_ms: [1000,60000], cooldown_ms: [1000,86400000], evaluation_interval_ms: [1000,60000],
 sensor_max_age_ms: [1000,300000], required_valid_sensors: [1,3], max_sensor_spread_percent: [0,100],
 max_activations_per_hour: [1,3600], max_cumulative_on_ms_per_hour: [1000,3600000],
};
const coolingRanges={
 temperature_min:[-40,80],temperature_max:[-40,80],
 temperature_start_threshold:[-40,80],temperature_stop_threshold:[-40,80],
 cooling_humidity_limit:[0,100],max_temperature_spread_c:[0,20],
};
function validateConfig(input = {}) {
 if(!input || typeof input!=='object' || Array.isArray(input))throw new AppError('Cấu hình không hợp lệ',400);
 const c = { sensor_max_age_ms: 20000, required_valid_sensors: 3, ...input };
 const allowed = [...Object.keys(ranges),...Object.keys(coolingRanges),'cooling_enabled','config_source','profile_name','profile_approved'];
 if (Object.keys(c).some(k => !allowed.includes(k))) throw new AppError('Trường cấu hình không được hỗ trợ; hãy dùng chức năng khởi động để bật chế độ tự động (AUTO)',400);
 if(c.config_source!==undefined && !['LEGACY','FLOOR'].includes(c.config_source))throw new AppError('Nguồn cấu hình (config_source) không hợp lệ',400);
 if(c.config_source==='FLOOR' && c.mushroom_type_id!=null)throw new AppError('Cấu hình tầng xác định loại nấm từ các phiên trồng trong khay',400);
 for (const [key,[min,max]] of Object.entries(ranges)) {
  if(key==='mushroom_type_id' && c.config_source==='FLOOR')continue;
  if (typeof c[key] !== 'number' || !Number.isFinite(c[key]) || c[key]<min || c[key]>max
   || (!key.startsWith('humidity_') && key!=='max_sensor_spread_percent' && !Number.isInteger(c[key]))) {
   throw new AppError(`${key} không hợp lệ: giá trị phải từ ${min} đến ${max}`,400);
  }
 }
 if(c.cooling_enabled!==undefined && typeof c.cooling_enabled!=='boolean')throw new AppError('Giá trị cooling_enabled không hợp lệ',400);
 for(const [key,[min,max]] of Object.entries(coolingRanges)) {
  if(c[key]==null && !c.cooling_enabled)continue;
  if(typeof c[key]!=='number' || !Number.isFinite(c[key]) || c[key]<min || c[key]>max)
   throw new AppError(`${key} không hợp lệ: giá trị phải từ ${min} đến ${max}`,400);
 }
 if(c.cooling_enabled && !(c.temperature_min<c.temperature_max
  && c.temperature_stop_threshold>=c.temperature_min
  && c.temperature_stop_threshold<c.temperature_start_threshold
  && c.temperature_start_threshold<=c.temperature_max
  && c.cooling_humidity_limit>c.humidity_stop_threshold && c.cooling_humidity_limit<=c.humidity_max))
  throw new AppError('Ngưỡng làm mát hoặc giới hạn độ ẩm không nhất quán',400);
 if (!(c.humidity_min<c.humidity_max && c.humidity_start_threshold<c.humidity_stop_threshold
  && c.humidity_start_threshold<=c.humidity_min && c.humidity_stop_threshold<=c.humidity_max
  && c.max_cumulative_on_ms_per_hour>=c.misting_pulse_ms)) throw new AppError('Ngưỡng độ ẩm hoặc giới hạn thời gian phun sương không nhất quán',400);
 if (c.profile_name != null && (typeof c.profile_name!=='string' || !c.profile_name.trim() || c.profile_name.length>200)) throw new AppError('Tên cấu hình (profile_name) không hợp lệ',400);
 if (c.profile_approved !== undefined && typeof c.profile_approved!=='boolean') throw new AppError('profile_approved phải là true hoặc false',400);
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
 const temperatures=good.filter(s=>Number.isFinite(s.temperature) && s.temperature>=-40 && s.temperature<=80);
 const averageTemperature=temperatures.length?temperatures.reduce((a,s)=>a+s.temperature,0)/temperatures.length:null;
 const spread=good.length?Math.max(...good.map(s=>s.humidity))-Math.min(...good.map(s=>s.humidity)):null;
 const temperatureSpread=temperatures.length?Math.max(...temperatures.map(s=>s.temperature))-Math.min(...temperatures.map(s=>s.temperature)):null;
 const reason=good.length<c.required_valid_sensors?'Dữ liệu cảm biến bị thiếu, không hợp lệ, là bản tin lưu giữ hoặc đã quá cũ':spread>c.max_sensor_spread_percent?'Chênh lệch độ ẩm giữa các cảm biến vượt ngưỡng cho phép':
  c.cooling_enabled && temperatures.length<c.required_valid_sensors?'Dữ liệu cảm biến nhiệt độ bị thiếu hoặc không hợp lệ':
  c.cooling_enabled && temperatureSpread>c.max_temperature_spread_c?'Chênh lệch nhiệt độ giữa các cảm biến vượt ngưỡng cho phép':null;
 return { sensors, averageHumidity, averageTemperature, spread, temperatureSpread, healthy:!reason, reason };
}
// Demand latches below start; clears at/above stop. While latched, repeat bounded
// pulses after cooldown, including inside the hysteresis band. No continuous ON.
function decide({ running, config:c, runtime:r={}, environment:e, online=true, count=0, duration=0, now=Date.now() }) {
 if (!running) return {action:'NONE',state:'DISABLED',reason:'Chế độ thủ công (MANUAL)'};
 const active=['ON_REQUESTED','MISTING'].includes(r.control_state);
 if (r.control_state==='OFF_PENDING') return {action:'OFF',state:'OFF_PENDING',reason:'Đang chờ xác nhận trạng thái tắt (OFF)'};
 if (active && now>=new Date(r.pulse_deadline_at).getTime()) return {action:'OFF',state:'OFF_PENDING',reason:'Đã hết thời gian của đợt phun sương'};
 if (!online || !e.healthy) return {action:active?'OFF':'NONE',state:online?'SENSOR_FAULT':'DEVICE_OFFLINE',reason:online?e.reason:'MQTT hoặc bộ điều khiển trung tâm mất kết nối'};
 const demand=e.averageHumidity>=c.humidity_stop_threshold?false:e.averageHumidity<c.humidity_start_threshold?true:!!r.demand;
 const coolingDemand=!!c.cooling_enabled && (e.averageTemperature>=c.temperature_start_threshold?true:
  e.averageTemperature<=c.temperature_stop_threshold?false:!!r.cooling_demand);
 const blocked=!!c.cooling_enabled && e.averageHumidity>=c.cooling_humidity_limit;
 const flags={demand,coolingDemand};
 const reason=coolingDemand && blocked?'Không thể làm mát do độ ẩm đã đạt giới hạn; cần thông gió hoặc dùng phương pháp làm mát khác':
  demand?'Cần phun sương do độ ẩm thấp':coolingDemand?'Cần làm mát do nhiệt độ cao':'Không còn nhu cầu điều chỉnh nhiệt độ và độ ẩm';
 if (active) return {action:e.averageHumidity>=c.humidity_max || blocked?'OFF':'NONE',state:r.control_state,...flags,
  reason:blocked?reason:'Đang thực hiện đợt phun sương'};
 if (r.cooldown_until && now<new Date(r.cooldown_until).getTime()) return {action:'NONE',state:'COOLDOWN',...flags,reason:'Đang chờ giữa các đợt phun sương'};
 if ((!demand && !coolingDemand) || blocked || e.averageHumidity>=c.humidity_max) return {action:'NONE',state:'IDLE',...flags,reason};
 if (count>=c.max_activations_per_hour || duration+c.misting_pulse_ms>c.max_cumulative_on_ms_per_hour) return {action:'NONE',state:'IDLE',...flags,reason:'Đã đạt giới hạn phun sương an toàn trong giờ'};
 return {action:'ON',state:'ON_REQUESTED',...flags,reason};
}
module.exports={ranges,coolingRanges,validateConfig,aggregate,decide};
