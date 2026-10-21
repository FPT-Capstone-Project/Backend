const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const jwt=require('jsonwebtoken');

test('automation routes require JWT and a data-driven permission for every mutation',async()=>{
 // Authentication here verifies JWT/user state; email delivery is unrelated.
 require.cache[require.resolve('../src/services/email.service')]={exports:{sendOtpEmail:async()=>{}}};
 const dbPath=require.resolve('../src/config/db');
 require.cache[dbPath]={exports:{query:async(sql,args)=>({rows:args[0]===42?[{allowed:1}]:[]})}};
 const userPath=require.resolve('../src/models/user.model');
 require.cache[userPath]={exports:{findById:async id=>({user_id:id,role_id:id===1?42:99,status:'ACTIVE'})}};
 const servicePath=require.resolve('../src/services/autoMisting.service');
 let mutations=0;
 require.cache[servicePath]={exports:Object.fromEntries(['list','map','assignTray','environment','configuration','suggestions','save','start','stop','status','logs','evaluate'].map(name=>[name,async()=>{
  if(['map','assignTray','save','start','stop','evaluate'].includes(name))mutations++;return {mode:'MANUAL'};
 }]))};
 const app=express();app.use(express.json());app.use('/api/iot',require('../src/routes/iot.routes'));
 app.use((e,req,res,next)=>res.status(e.statusCode||500).json({message:e.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}/api/iot/floors`;
 const env=require('../src/config/env');const token=id=>jwt.sign({sub:String(id)},env.jwtSecret);
 const actions=[['POST',''],['PUT','/1'],['PUT','/1/trays/1'],['PUT','/1/auto-control'],['POST','/1/auto-control/start'],['POST','/1/auto-control/stop'],['POST','/1/auto-control/evaluate']];
 try{
  for(const [method,path] of actions)for(const [id,expected] of [[null,401],[2,403],[1,method==='POST' && (path==='' || path.endsWith('/start'))?201:200]]){
   const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(id?{authorization:`Bearer ${token(id)}`}:{})},body:'{}'});
   assert.equal(response.status,expected,`${method} ${path} user ${id}`);await response.json();
  }
  assert.equal(mutations,7);
  assert.equal((await fetch(base+'/1/trays/1/cultivation',{
   method:'PUT',headers:{authorization:`Bearer ${token(1)}`,'content-type':'application/json'},body:'{}',
  })).status,404);
  for(const [id,status] of [[null,401],[2,403],[1,200]]) {
   assert.equal((await fetch(base+'/1/auto-control/suggestions',{headers:id?{authorization:`Bearer ${token(id)}`}:{}})).status,status);
  }
  assert.equal((await fetch(base,{headers:{authorization:`Bearer ${token(2)}`}})).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Swagger covers all floor APIs with JWT, validation and permission errors',()=>{
 const spec=require('../src/config/autoMisting-swagger');
 assert.equal(Object.keys(spec.paths).length,11);
 for(const path of Object.values(spec.paths))for(const op of Object.values(path)){
  assert.deepEqual(op.security,[{bearerAuth:[]}]);for(const code of [400,401,403,409,503])assert.ok(op.responses[code]);
 }
 assert.equal(spec.paths['/api/iot/floors/{floorId}/auto-control/start'].post.requestBody.content['application/json'].schema.properties.dryRun.default,true);
});
