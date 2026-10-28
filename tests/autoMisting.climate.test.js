const test=require('node:test');
const assert=require('node:assert/strict');
const {suggest,summarize,assertCompatible}=require('../src/services/autoMisting.profile');
const {validateConfig,aggregate,decide}=require('../src/services/autoMisting.algorithm');
const profiles=[
 {mushroom_type_id:1,temperature_min:'24',temperature_max:'28',humidity_min:'85',humidity_max:'95'},
 {mushroom_type_id:2,temperature_min:'25',temperature_max:'29',humidity_min:'88',humidity_max:'96'},
];
const config=suggest(profiles).config;
const now=Date.now();
const decision=(temperature,humidity,runtime={},extra={})=>decide({
 running:true,config,runtime,environment:{healthy:true,averageTemperature:temperature,averageHumidity:humidity},now,...extra,
});
test('shared profile uses intersections and provides an editable valid config',()=>{
 assert.deepEqual(suggest(profiles).common,{temperature_min:25,temperature_max:28,humidity_min:88,humidity_max:95});
 assert.equal(validateConfig(config).cooling_enabled,true);
 assert.equal(config.mushroom_type_id,undefined);
 for(const bad of [[],[{...profiles[0],humidity_min:95}], [{...profiles[0],temperature_min:null}],
  [{...profiles[0],humidity_min:94}], [...profiles,{...profiles[0],mushroom_type_id:3,temperature_min:30,temperature_max:35}]])
  assert.equal(suggest(bad).config,null);
});
test('legacy CO2 snapshots do not block temperature and humidity automation',()=>{
 const legacy=profiles.map((p,i)=>({...p,co2_min:i?1000:350,co2_max:i?1500:500}));
 assert.deepEqual(summarize(legacy),summarize(profiles));
 assert.deepEqual(summarize(profiles).warnings,[]);
 assert.deepEqual(assertCompatible({...config,source_profiles:legacy},profiles,true),
  summarize(profiles).sourceProfiles);
});

test('cooling has independent hysteresis, humidity cutoff and normal safety limits',()=>{
 assert.equal(decision(28,93).action,'ON');
 assert.equal(decision(27,93).action,'NONE');
 assert.equal(decision(27,93,{cooling_demand:true}).action,'ON');
 assert.equal(decision(26.5,93,{cooling_demand:true}).coolingDemand,false);
 assert.equal(decision(26,87).action,'ON');
 assert.equal(decision(30,94).action,'NONE');
 assert.match(decision(30,94).reason,/độ ẩm đã đạt giới hạn/);
 const active={control_state:'MISTING',pulse_deadline_at:new Date(now+1000),cooling_demand:true};
 assert.equal(decision(30,94,active).action,'OFF');
 assert.equal(decision(30,93,{}, {count:20}).action,'NONE');
 assert.equal(decision(30,93,{cooldown_until:new Date(now+1000)}).action,'NONE');
 assert.equal(decision(30,93,{}, {online:false}).action,'NONE');
 assert.equal(decision(30,93,{}, {online:false}).state,'DEVICE_OFFLINE');
});
test('temperature missing, out of bounds or disagreement blocks cooling',()=>{
 const readings=()=>[1,2,3].map(sensor_address=>({sensor_address,temperature:28,humidity:90,is_valid:true,retained:false,last_received_at:new Date(now)}));
 assert.equal(aggregate(readings(),config,now).healthy,true);
 for(const temperature of [null,NaN,81,-41,34]) {
  const rows=readings();rows[0].temperature=temperature;
  assert.equal(aggregate(rows,config,now).healthy,false);
 }
 for(const patch of [{cooling_enabled:'true'},{temperature_stop_threshold:29},{temperature_min:null},
  {cooling_humidity_limit:90},{max_temperature_spread_c:-1},{temperature_max:Infinity}])
  assert.throws(()=>validateConfig({...config,...patch}));
});
