const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const model=require('../src/models/cultivationTray.model');
const service=require('../src/services/cultivationTray.service');
test('sanitation checks staff role and valid ID before accessing database',async()=>{
 for(const actor of [null,{role_id:3,user_id:1}])await assert.rejects(service.completeSanitation(1,actor),{statusCode:403});
 await assert.rejects(service.completeSanitation(0,{role_id:2,user_id:1}),{statusCode:400});
});
test('sanitation atomically records operator/time, rejects active assignments and repeated confirmation',async()=>{
 const db=new PGlite();try{
 await db.exec(fs.readFileSync('database.sql','utf8'));await db.exec(fs.readFileSync('migrations/031_tray_sanitation_confirmation.sql','utf8'));
 await db.exec(`INSERT INTO roles(role_name) VALUES('Farm Operator');
 INSERT INTO users(role_id,email,password_hash,full_name) VALUES(1,'clean@example.test','test','Operator');
 INSERT INTO cultivation_rooms(room_code,room_name) VALUES('CLEAN','Room');
 INSERT INTO cultivation_trays(room_id,tray_code,status) VALUES(1,'CLEAN-1','MAINTENANCE'),(1,'CLEAN-2','OCCUPIED');`);
 await assert.rejects(model.completeSanitation(999,1,db),{statusCode:404});
 await assert.rejects(model.completeSanitation(2,1,db),{statusCode:409});
 const blocked={query:(sql,args)=>sql.includes('FROM cultivation_session_trays')?Promise.resolve({rows:[{active:1}]}):db.query(sql,args)};
 await assert.rejects(model.completeSanitation(1,1,blocked),{statusCode:409});
 assert.equal((await db.query('SELECT status FROM cultivation_trays WHERE tray_id=1')).rows[0].status,'MAINTENANCE');
 await assert.rejects(model.completeSanitation(1,999,db),{code:'23503'});
 const tray=await model.completeSanitation(1,1,db);assert.equal(tray.status,'AVAILABLE');assert.equal(tray.last_cleaned_by,1);assert.ok(tray.last_cleaned_at);
 await assert.rejects(model.completeSanitation(1,1,db),{statusCode:409});
 const after=(await db.query('SELECT * FROM cultivation_trays WHERE tray_id=1')).rows[0];assert.deepEqual(after.last_cleaned_at,tray.last_cleaned_at);
 }finally{await db.close();}
});
