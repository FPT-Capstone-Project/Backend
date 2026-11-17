const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const pool = require('../src/config/db');
const service = require('../src/services/inventory.service');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const users = require('../src/models/user.model');

test('inventory SQL, validation, atomicity and API authorization', async t => {
 const db = new PGlite();
 await db.exec(`CREATE TABLE mushroom_types (mushroom_type_id SERIAL PRIMARY KEY, name TEXT, status TEXT DEFAULT 'ACTIVE');
 CREATE TABLE spawn_inventory (inventory_id SERIAL PRIMARY KEY, mushroom_type_id INTEGER NOT NULL UNIQUE REFERENCES mushroom_types, quantity NUMERIC NOT NULL DEFAULT 0 CHECK(quantity>=0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
 CREATE TABLE inventory_transactions (transaction_id SERIAL PRIMARY KEY, inventory_id INTEGER NOT NULL REFERENCES spawn_inventory, session_id INTEGER, transaction_type VARCHAR NOT NULL CHECK(transaction_type IN ('IN','OUT','ADJUST')), quantity NUMERIC NOT NULL, quantity_before NUMERIC NOT NULL, quantity_after NUMERIC NOT NULL, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());`);
 // Fixtures exist only inside the isolated in-memory test database.
 await db.exec("INSERT INTO mushroom_types(name,status) VALUES ('Oyster','ACTIVE'),('Inactive','INACTIVE'),('Empty','ACTIVE')");
 const queries=[];
 let fail;
 const query=async(sql,args)=>{queries.push(sql);if(fail && sql.includes(fail)) throw new Error('injected failure');return db.query(sql,args);};
 t.mock.method(pool,'query',query);
 t.mock.method(pool,'connect',async()=>({query,release(){}}));
 const rejected=(fn,status)=>assert.rejects(fn,{statusCode:status});
 try {
 await t.test('empty list and database errors',async()=>{assert.deepEqual((await service.list()).data,[]);fail='COUNT';await assert.rejects(()=>service.list(),/injected/);fail=null;});
 let row;
 await t.test('create with IN audit and duplicate protection',async()=>{row=await service.create({mushroomTypeId:1,quantity:50,notes:'Initial'});assert.equal(row.quantity,'50');const tx=(await db.query('SELECT * FROM inventory_transactions')).rows[0];assert.equal(tx.transaction_type,'IN');assert.equal(tx.quantity_before,'0');assert.equal(tx.quantity_after,'50');await rejected(()=>service.create({mushroomTypeId:1,quantity:5}),409);});
 await t.test('create validation and eligibility',async()=>{for(const quantity of [0,-1,null,true,'5']) await rejected(()=>service.create({mushroomTypeId:3,quantity}),400);await rejected(()=>service.create({mushroomTypeId:999,quantity:1}),404);await rejected(()=>service.create({mushroomTypeId:2,quantity:1}),409);await rejected(()=>service.create({mushroomTypeId:false,quantity:1}),400);});
 await t.test('list joins, pagination and filters',async()=>{const r=await service.list({search:'oyster',mushroomTypeId:'1',page:'1',limit:'1'});assert.equal(r.data[0].mushroom_name,'Oyster');assert.equal(r.pagination.total,1);assert.equal((await service.list({page:2,limit:1})).data.length,0);});
 await t.test('failed IN audit rolls back inventory insert',async()=>{fail='INSERT INTO inventory_transactions';await assert.rejects(()=>service.create({mushroomTypeId:3,quantity:1}),/injected/);fail=null;assert.equal((await db.query('SELECT * FROM spawn_inventory WHERE mushroom_type_id=3')).rows.length,0);});
 await t.test('adjust locks row, computes exact delta, and skips unchanged quantity',async()=>{queries.length=0;await service.update(row.inventory_id,{quantity:40.5,notes:'Count'});assert.ok(queries.some(q=>q.includes('FOR UPDATE')));const tx=(await db.query("SELECT * FROM inventory_transactions WHERE transaction_type='ADJUST'")).rows[0];assert.equal(tx.quantity,'9.5');assert.equal(tx.quantity_before,'50');assert.equal(tx.quantity_after,'40.5');const count=(await db.query('SELECT count(*) FROM inventory_transactions')).rows;await service.update(row.inventory_id,{quantity:40.5,notes:'Same'});assert.deepEqual((await db.query('SELECT count(*) FROM inventory_transactions')).rows,count);});
 await t.test('update validation and rollback on either write failure',async()=>{await rejected(()=>service.update('bad',{quantity:1,notes:'Count'}),400);await rejected(()=>service.update(1,{quantity:-1,notes:'Count'}),400);await rejected(()=>service.update(1,{quantity:1}),400);await rejected(()=>service.update(1,{quantity:1,notes:'Count',quantity_before:99}),400);for(const sql of ['UPDATE spawn_inventory','INSERT INTO inventory_transactions']){fail=sql;await assert.rejects(()=>service.update(1,{quantity:10,notes:'Count'}),/injected/);fail=null;assert.equal((await db.query('SELECT quantity FROM spawn_inventory WHERE inventory_id=1')).rows[0].quantity,'40.5');}await rejected(()=>service.update(999,{quantity:1,notes:'Count'}),404);});
 await t.test('delete enforces balance and history',async()=>{await rejected(()=>service.remove(1),409);await service.update(1,{quantity:0,notes:'Count'});await rejected(()=>service.remove(1),409);await db.exec('INSERT INTO spawn_inventory(mushroom_type_id,quantity) VALUES(3,1)');const empty=(await db.query('SELECT inventory_id FROM spawn_inventory WHERE mushroom_type_id=3')).rows[0].inventory_id;await rejected(()=>service.remove(empty),409);await db.query('UPDATE spawn_inventory SET quantity=0 WHERE inventory_id=$1',[empty]);await service.remove(empty);await rejected(()=>service.remove(empty),404);});
 await t.test('exports only OUT, filters, pagination, empty and invalid dates',async()=>{assert.equal((await service.exports()).data.length,0);await db.exec("INSERT INTO inventory_transactions(inventory_id,session_id,transaction_type,quantity,quantity_before,quantity_after,notes) VALUES(1,8,'OUT',1,2,1,'Payment')");const result=await service.exports({mushroomTypeId:1,sessionId:8,fromDate:'2020-01-01',toDate:'2099-01-01',limit:1});assert.equal(result.pagination.total,1);assert.equal(result.data[0].transaction_type,'OUT');assert.equal(result.data[0].mushroom_name,'Oyster');assert.equal((await service.exports({sessionId:9})).data.length,0);await rejected(()=>service.exports({fromDate:'2026-02-30'}),400);await rejected(()=>service.exports({fromDate:'2026-01-02',toDate:'2026-01-01'}),400);});
 await t.test('all five routes enforce real JWT authentication and roles',async()=>{
  const express=require('express');let role=1;
  t.mock.method(users,'findById',async()=>({user_id:1,role_id:role,status:'ACTIVE'}));
  const app=express();app.use(express.json());app.use('/api/inventory/admin',require('../src/routes/inventory.routes'));app.use((e,req,res,next)=>res.status(e.statusCode||500).json({message:e.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{for(const allowed of [1,2,3,99,null]){role=allowed;for(const [method,path] of [['GET',''],['POST',''],['PATCH','/1'],['DELETE','/1'],['GET','/exports']]){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/inventory/admin${path}`,{method,headers:allowed?{authorization:'Bearer '+jwt.sign({sub:'1'},env.jwtSecret)}:{}});await response.text();if(allowed===null)assert.equal(response.status,401);else if(allowed===3||allowed===99)assert.equal(response.status,403);else assert.ok(![401,403,500].includes(response.status));}}}finally{await new Promise(r=>server.close(r));}
 });
 } finally { await db.close(); }
});
