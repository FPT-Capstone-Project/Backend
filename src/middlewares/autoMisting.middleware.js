const pool=require('../config/db');
const AppError=require('../utils/app-error');
async function manageAutomation(req,res,next) {
 try {
  const result=await pool.query(`SELECT 1 FROM role_permissions rp JOIN permissions p USING(permission_id)
   WHERE rp.role_id=$1 AND p.permission_name='iot.automation.manage'`,[req.user?.role_id]);
  if(!result.rows.length)throw new AppError('iot.automation.manage permission required',403);
  next();
 }catch(error){next(error);}
}
module.exports={manageAutomation};
