const service=require('../services/autoMisting.service');
const AppError=require('../utils/app-error');
function handler(fn,status=200) {
 return async(req,res,next)=>{
  try{res.status(status).json({data:await fn(req)});}
  catch(error){
   if(['23505','23503','23514'].includes(error.code))return next(new AppError('Mapping or configuration conflicts with existing data or constraints',409));
   next(error);
  }
 };
}
module.exports={
 list:handler(()=>service.list()),
 create:handler(r=>service.map(null,r.body),201),
 map:handler(r=>service.map(r.params.floorId,r.body)),
 tray:handler(r=>service.assignTray(r.params.floorId,r.params.trayId)),
 cultivation:handler(r=>service.cultivation(r.params.floorId,r.params.trayId,r.body,r.user.user_id)),
 environment:handler(r=>service.environment(r.params.floorId)),
 configuration:handler(r=>service.configuration(r.params.floorId)),
 suggestions:handler(r=>service.suggestions(r.params.floorId)),
 save:handler(r=>service.save(r.params.floorId,r.body,r.user.user_id)),
 start:handler(r=>service.start(r.params.floorId,r.body,r.user.user_id),201),
 stop:handler(r=>service.stop(r.params.floorId,r.user.user_id)),
 status:handler(r=>service.status(r.params.floorId)),
 logs:handler(r=>service.logs(r.params.floorId,r.query)),
 evaluate:handler(r=>service.evaluate(r.params.floorId,true)),
};
