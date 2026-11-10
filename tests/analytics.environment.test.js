const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');

test('environment charts aggregate sensor readings without cultivation sessions through the staff API', async () => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const userPath = require.resolve('../src/models/user.model');
  const previousDb = require.cache[dbPath], previousUser = require.cache[userPath];
  let server, queryCount = 0;
  try {
    await db.exec(fs.readFileSync('database.sql', 'utf8'));
    require.cache[dbPath] = { exports: { query: (...args) => { queryCount++; return db.query(...args); } } };
    require.cache[userPath] = { exports: { findById: async id => ({ user_id: id, role_id: id, status: 'ACTIVE' }) } };
    server = require('../src/app').listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const request = async (suffix = '', role = 1) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/analytics/dashboard/environment-history${suffix}`, {
        headers: role ? { authorization: `Bearer ${jwt.sign({ sub: String(role) }, require('../src/config/env').jwtSecret)}` } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await request('', 0)).status, 401);
    assert.equal((await request('', 3)).status, 403);
    assert.equal(queryCount, 0);
    const empty = await request('', 2);
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body.data.floors, []);
    assert.equal(empty.body.data.to - empty.body.data.from, 86400000);
    assert.equal(empty.body.data.to % 300000, 0);
    for (const suffix of ['?from=x', '?from=x&to=y', '?from=2026-11-01&to=2026-11-02',
      '?from=2026-11-01T00:00:00Z&to=2026-11-03T00:00:00Z',
      '?from=2026-11-01T00:00:00Z&to=2026-11-01T00:00:00Z',
      '?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z',
      '?from=x&from=y&to=2026-11-01T00:00:00Z']) {
      const before = queryCount;
      assert.equal((await request(suffix)).status, 400);
      assert.equal(queryCount, before);
    }
    await db.exec(`
      INSERT INTO cultivation_rooms(room_code,room_name) VALUES ('R','Room');
      INSERT INTO iot_masters(master_identifier,cultivation_room_id) VALUES ('m1',1),('m2',1);
      INSERT INTO cultivation_floors(room_id,floor_number,floor_name,master_id,node_address,misting_ssr_channel,status)
        VALUES (1,1,'Tầng 1',1,1,1,'ACTIVE'),(1,2,'Tầng 2',1,2,2,'ACTIVE'),
          (1,3,'Empty',2,1,1,'ACTIVE'),(1,4,'Inactive',2,2,2,'INACTIVE');
      INSERT INTO iot_auto_control_configs(floor_id,humidity_min,humidity_max,humidity_start_threshold,
        humidity_stop_threshold,misting_pulse_ms,cooldown_ms,evaluation_interval_ms,
        max_activations_per_hour,max_cumulative_on_ms_per_hour,temperature_min,temperature_max,max_sensor_spread_percent,
        config_source,source_profiles)
        VALUES (1,75,90,74,85,1000,1000,1000,20,60000,20,30,10,'FLOOR','[]');
      INSERT INTO iot_sensor_readings
        (master_id,node_address,sensor_address,received_at,temperature,humidity,is_valid,retained) VALUES
        (1,1,1,'2026-11-01T00:00:00Z',20,60,true,false),
        (1,1,1,'2026-11-01T00:10:00Z',30,80,true,false),
        (1,1,2,'2026-11-01T00:05:00Z',35,90,true,false),
        (1,1,1,'2026-11-01T00:15:00Z',NULL,50,true,false),
        (1,2,1,'2026-11-01T00:05:00Z',22,66,true,false),
        (1,1,3,'2026-11-01T00:05:00Z',100,100,false,false),
        (1,1,3,'2026-11-01T00:06:00Z',100,100,true,true),
        (1,1,3,'2026-11-01T00:07:00Z',126,101,true,false),
        (1,1,3,'2026-11-01T00:08:00Z',-41,-1,true,false),
        (1,1,1,'2026-10-31T23:59:59Z',100,100,true,false),
        (1,1,1,'2026-11-02T00:00:00Z',100,100,true,false),
        (2,2,1,'2026-11-01T00:05:00Z',100,100,true,false);
    `);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM cultivation_sessions')).rows[0].count, 0);
    const before = queryCount;
    const result = await request('?from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z');
    assert.equal(result.status, 200);
    assert.equal(queryCount - before, 1);
    const { floors, from, to } = result.body.data;
    assert.equal(floors.length, 3);
    assert.equal(floors[0].floorName, 'Tầng 1');
    assert.equal(floors[0].masterId, 'm1');
    assert.deepEqual(floors[0].thresholds, { temperature_min: 20, temperature_max: 30, humidity_min: 75, humidity_max: 90 });
    assert.deepEqual(floors[0].points[0], { timestamp: from, temperature: 30, humidity: 80 });
    assert.deepEqual(floors[0].points[1], { timestamp: from + 900000, temperature: null, humidity: 50 });
    assert.deepEqual(floors[1].points[0], { timestamp: from, temperature: 22, humidity: 66 });
    for (const floor of floors) {
      assert.equal(floor.points.length, 96);
      assert.equal(floor.points[95].timestamp, to - 900000);
      assert.equal(floor.points[95].temperature, null);
    }
    assert.ok(floors[2].points.every(p => p.temperature === null && p.humidity === null));
    assert.equal(floors[2].thresholds.temperature_min, null);
    const partial = await request('?from=2026-11-01T00:00:00Z&to=2026-11-01T00:16:00Z');
    assert.equal(partial.body.data.floors[0].points.length, 2);
    const shifted = await request('?from=2026-11-01T00:05:00Z&to=2026-11-01T00:15:00Z');
    assert.deepEqual(shifted.body.data.floors[0].points, [{
      timestamp: Date.parse('2026-11-01T00:05:00Z'), temperature: 32.5, humidity: 85,
    }]);
    const swagger = require('../src/config/swagger');
    assert.ok(swagger.paths['/api/analytics/dashboard/environment-history'].get.responses[200]);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
    if (previousUser) require.cache[userPath] = previousUser; else delete require.cache[userPath];
    await db.close();
  }
});
