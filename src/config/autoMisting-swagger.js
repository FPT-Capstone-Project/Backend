const {ranges,coolingRanges}=require('../services/autoMisting.algorithm');
const config={type:'object',additionalProperties:false,
 required:Object.keys(ranges).filter(k=>!['mushroom_type_id','sensor_max_age_ms','required_valid_sensors'].includes(k)),
 properties:Object.fromEntries(Object.entries(ranges).map(([k,[minimum,maximum]])=>[k,{type:k.startsWith('humidity_') || k==='max_sensor_spread_percent'?'number':'integer',minimum,maximum}]))};
Object.assign(config.properties,{profile_name:{type:'string',maxLength:200,nullable:true},profile_approved:{type:'boolean',default:false}});
Object.assign(config.properties,{
 config_source:{type:'string',enum:['LEGACY','FLOOR'],default:'LEGACY',description:'FLOOR derives crop types from assigned tray sessions; requires a reviewed named profile. LEGACY requires mushroom_type_id.'},
 cooling_enabled:{type:'boolean',default:false,description:'When true all temperature fields and cooling_humidity_limit are required.'},
 ...Object.fromEntries(Object.entries(coolingRanges).map(([k,[minimum,maximum]])=>[k,{type:'number',minimum,maximum}]))
});
const mapping={type:'object',additionalProperties:false,required:['room_id','floor_number','floor_name','master_id','node_address','misting_ssr_channel'],properties:{
 room_id:{type:'integer',minimum:1},floor_number:{type:'integer',minimum:1},floor_name:{type:'string',maxLength:200},
 master_id:{type:'integer',minimum:1},node_address:{type:'integer',minimum:1,maximum:247},misting_ssr_channel:{type:'integer',minimum:1,maximum:8},status:{type:'string',enum:['ACTIVE','INACTIVE']}}};
const example={mushroom_type_id:1,humidity_min:85,humidity_max:95,humidity_start_threshold:83,humidity_stop_threshold:87,
 misting_pulse_ms:5000,cooldown_ms:60000,evaluation_interval_ms:5000,sensor_max_age_ms:20000,required_valid_sensors:3,
 max_sensor_spread_percent:10,max_activations_per_hour:20,max_cumulative_on_ms_per_hour:100000};
const paths={};
const environmentSchema={type:'object',properties:{masterId:{type:'string'},nodeId:{type:'integer'},
 averageHumidity:{type:'number',nullable:true},averageTemperature:{type:'number',nullable:true},temperatureSpread:{type:'number',nullable:true},healthy:{type:'boolean'},reason:{type:'string',nullable:true},
 sensors:{type:'array',items:{type:'object',properties:{sensorId:{type:'integer'},humidity:{type:'number',nullable:true},valid:{type:'boolean'},ageMs:{type:'number',nullable:true},retained:{type:'boolean'}}}},thresholds:config}};
const statusSchema={type:'object',properties:{mode:{type:'string',enum:['MANUAL','AUTO']},run:{type:'object',nullable:true,properties:{status:{type:'string',enum:['RUNNING','STOPPED','FAULT']},dry_run:{type:'boolean'},started_by:{type:'integer',nullable:true}}},
 runtime:{type:'object',properties:{demand:{type:'boolean'},cooling_demand:{type:'boolean'},last_reason:{type:'string',nullable:true},control_state:{type:'string',enum:['DISABLED','IDLE','ON_REQUESTED','MISTING','OFF_PENDING','COOLDOWN','SENSOR_FAULT','DEVICE_OFFLINE','FAULT']},pulse_started_at:{type:'string',format:'date-time',nullable:true},pulse_deadline_at:{type:'string',format:'date-time',nullable:true},last_error:{type:'string',nullable:true}}},
 environment:environmentSchema,ssr:{type:'object',nullable:true,properties:{desired_state:{type:'string',enum:['ON','OFF'],nullable:true},reported_state:{type:'string',enum:['ON','OFF'],nullable:true}}},cooldownRemainingMs:{type:'number'},lastDecision:{type:'object',nullable:true}}};
function add(path,method,summary,schema,description='') {
 const operation={tags:['Automatic misting'],summary,description:`${description} ${method==='get'?'Authenticated read access.':'Requires iot.automation.manage permission.'}`,
 security:[{bearerAuth:[]}],parameters:[],responses:{
  [method==='post' && (path.endsWith('/start') || path.endsWith('/floors'))?'201':'200']:{description:'Result in {data: ...}. State includes mode, run, runtime, environment, ssr, cooldownRemainingMs and lastDecision.',content:{'application/json':{schema:{type:'object',properties:{data:{type:'object'}}}}}},
  400:{description:'Invalid fields, thresholds, ranges or pagination'},401:{description:'JWT missing or invalid'},403:{description:'Missing automation permission'},
  404:{description:'Floor not found'},409:{description:'Active run, unresolved OFF, invalid mapping, unhealthy sensors, unapproved profiles or hardware safety gate closed'},503:{description:'MQTT unavailable; OFF remains pending and is retried'}}};
 if(path.endsWith('/start'))operation.responses[504]={description:'OFF publication timed out or no new live OFF feedback within 5 seconds after publication; AUTO was not started'};
 for(const name of ['floorId','trayId'])if(path.includes(`{${name}}`))operation.parameters.push({name,in:'path',required:true,schema:{type:'integer',minimum:1}});
 if(path.endsWith('/logs'))for(const [name,max] of [['limit',1000],['offset',1000000]])operation.parameters.push({name,in:'query',schema:{type:'integer',minimum:name==='limit'?1:0,maximum:max}});
 if(schema)operation.requestBody={required:true,content:{'application/json':{schema,...(schema===config?{example}:{})}}};
 const success=operation.responses[200] || operation.responses[201];
 const content=success.content['application/json'];
 if(path.endsWith('/status') || path.endsWith('/stop')){
  content.schema.properties.data=statusSchema;
  content.example={data:{mode:'MANUAL',run:{status:'STOPPED',dry_run:true,started_by:1},runtime:{control_state:'DISABLED',pulse_deadline_at:null,last_error:null},ssr:{desired_state:'OFF',reported_state:'OFF'},cooldownRemainingMs:0}};
 }else if(path.endsWith('/environment')){
  content.schema.properties.data=environmentSchema;
  content.example={data:{masterId:'master01',nodeId:7,averageHumidity:84,averageTemperature:26,healthy:true,reason:null,sensors:[{sensorId:1,humidity:82,valid:true,ageMs:1000},{sensorId:2,humidity:84,valid:true,ageMs:1000},{sensorId:3,humidity:86,valid:true,ageMs:1000}]}};
 }else if(path.endsWith('/floors') && method==='get')content.schema.properties.data={type:'array',items:mapping};
 else if(path.endsWith('/start'))content.example={data:{mode:'AUTO',run:{id:1,status:'RUNNING',dry_run:true,started_by:1}}};
 else if(path.endsWith('/auto-control'))content.example={data:{mode:'MANUAL',config:example}};
 else if(path.endsWith('/evaluate'))content.example={data:{dryRun:true,decision:{action:'NONE',state:'DISABLED',reason:'MANUAL mode'}}};
 else if(path.endsWith('/logs'))content.example={data:{limit:100,offset:0,logs:[{event_type:'CONFIG_SAVED',reason:'Configuration saved; MANUAL remains active'}]}};
 paths[path]={...paths[path],[method]:operation};
}
const base='/api/iot/floors',floor=base+'/{floorId}',auto=floor+'/auto-control';
add(base,'get','List floor mappings');add(base,'post','Create floor mapping',mapping,'Master must already belong to this room. No inferred node/floor assignments.');
add(floor,'put','Replace floor mapping',mapping,'Stop and resolve OFF first. Channels and nodes are unique per master.');
add(floor+'/trays/{trayId}','put','Assign a same-room tray to a stopped floor');
add(floor+'/environment','get','Get three sensors, averages, freshness and thresholds');
add(auto,'get','Read saved configuration, mode, cultivation conflicts and suggestions');
add(auto+'/suggestions','get','Suggest a shared floor climate configuration',null,
 'Requires iot.automation.manage. Uses ACTIVE tray sessions linked to ACTIVE rentals on the same tray; returns sourceProfiles, common, issues, warnings, config. Config is null for missing, conflicting or too narrow conditions. No database writes or device commands. Review preset, set profile_approved=true and PUT config to auto-control.');
add(auto,'put','Save configuration without starting AUTO',config,'Example thresholds are for simulation only. Save remains MANUAL. Stop before edits.');
add(auto+'/start','post','Explicitly start a run',{type:'object',additionalProperties:false,properties:{dryRun:{type:'boolean',default:true}}},'Fresh non-retained sensors required. Real runs require MQTT and a verified local watchdog, then send OFF and wait up to 5 seconds after publication for new non-retained SSR OFF feedback before starting AUTO. Missing feedback returns 504 without starting a run. Default dryRun=true publishes nothing.');
add(auto+'/stop','post','Stop AUTO and request OFF',null,'Blocks new ON; unresolved physical state remains OFF_PENDING. OFF publish success is not confirmation.');
add(auto+'/status','get','Get run, operator, desired/reported SSR, deadlines and errors',null,
 'RUNNING/AUTO intent survives worker restart and backend shutdown. Recovery waits in OFF_PENDING for fresh live OFF feedback, then observes cooldown and rechecks prerequisites before a new pulse. STOPPED/FAULT runs are never automatically restarted.');
add(auto+'/logs','get','Read paginated decision history');
add(auto+'/evaluate','post','Preview current algorithm decision without side effects',null,'Does not start AUTO, update runtime or publish MQTT. MANUAL yields NONE. Use a dry run Start to simulate pulses.');
module.exports={paths,schemas:{AutoMistingConfiguration:config,CultivationFloorMapping:mapping}};
