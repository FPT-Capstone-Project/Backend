const test=require('node:test');
const assert=require('node:assert/strict');
const {validateConfig,aggregate,decide}=require('../src/services/autoMisting.algorithm');
const config={mushroom_type_id:1,humidity_min:85,humidity_max:95,humidity_start_threshold:83,humidity_stop_threshold:87,
 misting_pulse_ms:5000,cooldown_ms:60000,evaluation_interval_ms:5000,sensor_max_age_ms:20000,required_valid_sensors:3,
 max_sensor_spread_percent:10,max_activations_per_hour:20,max_cumulative_on_ms_per_hour:100000};
const now=Date.now();
const readings=()=>[82,84,86].map((humidity,i)=>({sensor_address:i+1,humidity,temperature:25,is_valid:true,retained:false,last_received_at:new Date(now)}));
test('configuration uses no cultivation defaults and rejects mode, unsafe ranges and malformed values',()=>{
 assert.deepEqual(validateConfig(config),{...config,profile_name:null,profile_approved:false});
 for(const c of [{},{...config,mode:'AUTO'},{...config,humidity_min:null},{...config,humidity_start_threshold:90},
  {...config,humidity_max:Infinity},{...config,misting_pulse_ms:60001},{...config,required_valid_sensors:2.5},
  {...config,max_cumulative_on_ms_per_hour:1000},{...config,profile_approved:'true'}])assert.throws(()=>validateConfig(c));
 const {required_valid_sensors,sensor_max_age_ms,...partial}=config;
 assert.equal(validateConfig(partial).required_valid_sensors,3);assert.equal(validateConfig(partial).sensor_max_age_ms,20000);
});
test('three-sensor mean and temperature',()=>{
 const e=aggregate(readings(),config,now);assert.equal(e.averageHumidity,84);assert.equal(e.averageTemperature,25);assert.equal(e.healthy,true);
});
for(const [name,edit] of [
 ['invalid',r=>r[0].is_valid=false],['null',r=>r[0].humidity=null],['NaN',r=>r[0].humidity=NaN],
 ['out of range',r=>r[0].humidity=101],['retained',r=>r[0].retained=true],['missing',r=>r.pop()],
 ['stale',r=>r[0].last_received_at=new Date(now-20001)],['future',r=>r[0].last_received_at=new Date(now+1)],
 ['spread',r=>r[0].humidity=60],
])test(`rejects ${name} sensors`,()=>{const r=readings();edit(r);assert.equal(aggregate(r,config,now).healthy,false);});
const evaluate=(patch={})=>decide({running:true,config,runtime:{},environment:{healthy:true,averageHumidity:81},now,...patch});
test('MANUAL never activates; below threshold activates',()=>{
 assert.equal(evaluate({running:false}).action,'NONE');assert.equal(evaluate().action,'ON');
});
test('hysteresis latches demand until stop threshold, strict start boundary and hard max',()=>{
 assert.equal(evaluate({environment:{healthy:true,averageHumidity:83}}).action,'NONE');
 assert.equal(evaluate({runtime:{demand:true},environment:{healthy:true,averageHumidity:85}}).action,'ON');
 assert.equal(evaluate({runtime:{demand:true},environment:{healthy:true,averageHumidity:87}}).demand,false);
 assert.equal(evaluate({runtime:{demand:true},environment:{healthy:true,averageHumidity:96}}).action,'NONE');
});
test('deadline always requests OFF despite disconnected MQTT, stale sensors or delayed ON feedback',()=>{
 const runtime={control_state:'MISTING',pulse_deadline_at:new Date(now),reported_state:'OFF'};
 assert.equal(evaluate({runtime,online:false,environment:{healthy:false}}).action,'OFF');
 assert.equal(evaluate({runtime:{...runtime,pulse_deadline_at:new Date(now+1000)}}).action,'NONE');
 assert.equal(evaluate({runtime:{...runtime,pulse_deadline_at:new Date(now+1000)},environment:{healthy:false,reason:'stale'}}).action,'OFF');
});
test('cooldown, activation cap, duration cap, disconnection and pending OFF block ON',()=>{
 assert.equal(evaluate({runtime:{cooldown_until:new Date(now+1)}}).action,'NONE');
 assert.equal(evaluate({count:20}).action,'NONE');assert.equal(evaluate({duration:99000}).action,'NONE');
 assert.equal(evaluate({online:false}).state,'DEVICE_OFFLINE');
 assert.equal(evaluate({runtime:{control_state:'OFF_PENDING'}}).action,'OFF');
});
module.exports={config};
