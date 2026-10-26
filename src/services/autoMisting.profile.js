const AppError = require('../utils/app-error');

// These are editable commissioning defaults, not crop-specific measured doses.
const preset = {
 misting_pulse_ms: 3000, cooldown_ms: 60000, evaluation_interval_ms: 5000,
 sensor_max_age_ms: 20000, required_valid_sensors: 3, max_sensor_spread_percent: 10,
 max_temperature_spread_c: 3, max_activations_per_hour: 20,
 max_cumulative_on_ms_per_hour: 200000,
};
function summarize(profiles) {
 const sourceProfiles=profiles.map(p=>Object.fromEntries(
  ['mushroom_type_id','temperature_min','temperature_max','humidity_min','humidity_max']
   .map(k=>[k,p[k]==null?null:Number(p[k])])))
  .sort((a,b)=>a.mushroom_type_id-b.mushroom_type_id);
 const issues=[], warnings=[], common={};
 if(!sourceProfiles.length)issues.push('No ACTIVE cultivation sessions linked to ACTIVE rentals on this floor');
 for(const metric of ['temperature','humidity']) {
  const complete=sourceProfiles.length>0 && sourceProfiles.every(p=>
   Number.isFinite(p[`${metric}_min`]) && Number.isFinite(p[`${metric}_max`])
   && p[`${metric}_min`]<p[`${metric}_max`]
   && p[`${metric}_min`]>=(metric==='temperature'?-40:0)
   && p[`${metric}_max`]<=(metric==='temperature'?80:100));
  if(!complete) {
   issues.push(`Missing or invalid ${metric} conditions`);
   continue;
  }
  const min=Math.max(...sourceProfiles.map(p=>p[`${metric}_min`]));
  const max=Math.min(...sourceProfiles.map(p=>p[`${metric}_max`]));
  common[`${metric}_min`]=min;common[`${metric}_max`]=max;
  if(min>=max)issues.push(`No shared ${metric} range`);
  else if((metric==='humidity' && max-min<=2) || (metric==='temperature' && max-min<1))
   issues.push(`Shared ${metric} range is too narrow for the automatic preset`);
 }
 return {sourceProfiles,common,issues,warnings};
}
function suggest(profiles) {
 const result=summarize(profiles);
 const {common:c,issues}=result;
 const config=issues.length?null:{
  config_source:'FLOOR',profile_name:'Shared floor profile',profile_approved:false,
  humidity_min:c.humidity_min,humidity_max:c.humidity_max,
  humidity_start_threshold:c.humidity_min,
  humidity_stop_threshold:c.humidity_min+(c.humidity_max-c.humidity_min)/2,
  cooling_enabled:true,temperature_min:c.temperature_min,temperature_max:c.temperature_max,
  temperature_start_threshold:c.temperature_max,
  temperature_stop_threshold:c.temperature_min+(c.temperature_max-c.temperature_min)/2,
  cooling_humidity_limit:c.humidity_max-1,...preset,
 };
 return {...result,config,warnings:[...result.warnings,
  'Review pulse duration, cooldown and hourly budgets for the installed equipment before saving and starting.']};
}
function assertCompatible(c,profiles,checkSnapshot=false) {
 const result=summarize(profiles);
 if(result.issues.length)throw new AppError(result.issues.join('; '),409);
 if(checkSnapshot && (!Array.isArray(c.source_profiles)
  || JSON.stringify(result.sourceProfiles)!==JSON.stringify(summarize(c.source_profiles).sourceProfiles)))
  throw new AppError('Floor cultivation conditions changed; review and save the floor profile again',409);
 const shared=result.common;
 if(c.humidity_min<shared.humidity_min || c.humidity_max>shared.humidity_max
  || c.humidity_start_threshold<shared.humidity_min
  || (c.cooling_enabled && (c.temperature_min<shared.temperature_min || c.temperature_max>shared.temperature_max)))
  throw new AppError('Configuration must stay inside the shared cultivation conditions',409);
 return result.sourceProfiles;
}
module.exports={suggest,summarize,assertCompatible};
