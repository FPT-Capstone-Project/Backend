const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('IoT migration and model SQL against isolated PostgreSQL', async (t) => {
  const db = new PGlite();
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/iot.model');
  const oldDb = require.cache[dbPath]; const oldModel = require.cache[modelPath];
  let returnedCommandClockSkewMs = 0;
  const adapter = { query: async (sql, values) => {
    const result = await db.query(sql, values);
    // Simulate a remote DB clock on the timestamp returned by command creation.
    if (returnedCommandClockSkewMs && sql.includes('INSERT INTO iot_device_commands')) {
      result.rows[0].requested_at = new Date(Date.now() + returnedCommandClockSkewMs);
    }
    return result;
  }, release() {} };
  require.cache[dbPath] = { exports: { ...adapter, totalCount: 1, idleCount: 1, waitingCount: 0, connect: async () => adapter } };
  delete require.cache[modelPath];
  const model = require('../src/models/iot.model');
  try {
    // Use the repository's complete existing schema, not invented user/room tables.
    await db.exec(fs.readFileSync(path.join(__dirname, '../database.sql'), 'utf8'));
    const message = { type: 'sensor', master: 'master01', node: 1, sensor: 1, ok: true, temperature: 27.5, humidity: 85.2 };
    const first = new Date('2026-10-16T10:00:00Z'); const second = new Date('2026-10-16T10:01:00Z');

    await t.test('migration provisions master01 and all eight unknown SSR channels', async () => {
      assert.equal((await model.findMasters()).length, 1);
      const states = await model.findSsr(1);
      assert.equal(states.length, 8);
      assert.ok(states.every((s) => s.reportedState === null && s.desiredState === null && s.statesMatch === null));
    });
    await t.test('light mapping persists and is returned in master reads', async () => {
      await db.exec("INSERT INTO cultivation_rooms(room_code,room_name) VALUES('LIGHT','Light room'); UPDATE iot_masters SET cultivation_room_id=1 WHERE id=1");
      assert.equal((await model.setLightChannel(1, 3)).light_ssr_channel, 3);
      assert.equal((await model.findMasters())[0].light_ssr_channel, 3);
      assert.equal((await model.findMaster('master01')).light_ssr_channel, 3);
      assert.equal((await model.setLightChannel(1, null)).light_ssr_channel, null);
    });
    await t.test('successful then failed poll retains last valid values with separate timestamps', async () => {
      await model.receive(message, first, false);
      await model.receive({ ...message, ok: false, temperature: null, humidity: null }, second, false);
      const latest = await model.findSensor(1, 1, 1);
      assert.equal(latest.ok, false); assert.equal(latest.temperature, 27.5); assert.equal(latest.humidity, 85.2);
      assert.equal(latest.lastValidAt.toISOString(), first.toISOString());
      assert.equal(latest.lastReceivedAt.toISOString(), second.toISOString());
      assert.equal(latest.measuredAt, null);
      const history = await model.history(1, 1, 1, { from: null, to: null, limit: 100, offset: 0 });
      assert.equal(history.length, 2); assert.equal(history[0].ok, false); assert.equal(history[0].temperature, null);
      assert.equal(history[1].temperature, 27.5);
    });
    await t.test('first failed sensor remains null, other nodes stay separate, older writes cannot replace latest', async () => {
      await model.receive({ ...message, node: 2, ok: false, temperature: null, humidity: null }, second, false);
      const other = await model.findSensor(1, 2, 1);
      assert.equal(other.temperature, null); assert.equal(other.lastValidAt, null);
      await model.receive({ ...message, temperature: 20 }, first, false);
      assert.equal((await model.findSensor(1, 1, 1)).ok, false);
      assert.equal((await model.findSensors(1)).length, 2);
    });
    await t.test('retained online status does not advance lastSeenAt; unknown masters ignored', async () => {
      const before = await model.findMaster('master01');
      await model.receive({ type: 'status', master: 'master01', status: 'online' }, new Date('2026-10-16T11:00:00Z'), true);
      const after = await model.findMaster('master01');
      assert.equal(after.lastSeenAt.toISOString(), before.lastSeenAt.toISOString());
      assert.equal(after.statusRetained, true); assert.equal(after.reportedStatus, 'online');
      assert.equal(await model.receive({ ...message, master: 'unknown' }, first, false), false);
    });
    await t.test('desired state, publication status and reported feedback are independent', async () => {
      const master = await model.findMaster('master01');
      returnedCommandClockSkewMs = -17000;
      const beforeCommand = Date.now();
      const record = await model.createCommand(master, 1, 'ON', null);
      const afterCommand = Date.now();
      returnedCommandClockSkewMs = 0;
      assert.equal((await model.findCommand(record.commandId)).status, 'PENDING');
      let states = await model.findSsr(1);
      assert.equal(states[0].desiredState, 'ON'); assert.equal(states[0].reportedState, null);
      assert.ok(states[0].lastCommandAt.getTime() >= beforeCommand);
      assert.ok(states[0].lastCommandAt.getTime() <= afterCommand);
      await model.finishCommand(record.commandId, 'PUBLISHED');
      await model.receive({ type: 'ssr', master: 'master01', channel: 1, state: 'OFF' }, first, false);
      states = await model.findSsr(1);
      assert.equal(states[0].desiredState, 'ON'); assert.equal(states[0].reportedState, 'OFF'); assert.equal(states[0].statesMatch, false);
      await model.receive({ type: 'ssr', master: 'master01', channel: 1, state: 'ON' }, second, false);
      assert.equal((await model.findSsr(1))[0].statesMatch, true);
      assert.equal((await model.findCommand(record.commandId)).status, 'PUBLISHED');
    });
    await t.test('SSR commit is immediately readable, traces DB phases and rejects stale feedback', async () => {
      const logs = [];
      const receivedAt = new Date('2026-10-16T12:00:00Z');
      const feedback = { type: 'ssr', master: 'master01', channel: 1, state: 'OFF' };
      await model.receive(feedback, receivedAt, false, {
        logger: { info: (line) => logs.push(JSON.parse(line)) }, context: { feedbackId: 'test-feedback' },
      });
      const current = (await model.findSsr(1))[0];
      assert.equal(current.reportedState, 'OFF');
      assert.equal(current.desiredState, 'ON');
      assert.equal(current.lastReportedAt.toISOString(), receivedAt.toISOString());
      assert.ok(logs.some((entry) => entry.event === 'ssr.db.pool.acquired'));
      assert.ok(logs.some((entry) => entry.event === 'ssr.db.query.done' && entry.operation === 'master_lock'));
      assert.equal(logs.at(-1).operation, 'COMMIT');
      await model.receive({ ...feedback, state: 'ON' }, second, false);
      await model.receive(message, second, false);
      assert.equal((await model.findSsr(1))[0].reportedState, 'OFF');
      assert.equal((await model.findMaster('master01')).lastSeenAt.toISOString(), receivedAt.toISOString());
    });
    await t.test('sensor write failure rolls back master freshness and history together', async () => {
      const before = await model.findMaster('master01');
      const count = (await db.query('SELECT count(*) AS n FROM iot_sensor_readings')).rows[0].n;
      await assert.rejects(model.receive({ ...message, sensor: 99 }, new Date('2026-10-16T13:00:00Z'), false));
      assert.equal((await model.findMaster('master01')).lastSeenAt.toISOString(), before.lastSeenAt.toISOString());
      assert.equal((await db.query('SELECT count(*) AS n FROM iot_sensor_readings')).rows[0].n, count);
    });
    await t.test('retained sensor preserves arrival time and retained flag without advancing master freshness', async () => {
      const before = await model.findMaster('master01');
      const at = new Date('2026-10-16T13:00:00Z');
      assert.equal(await model.receive(message, at, true), true);
      const latest = await model.findSensor(1, 1, 1);
      assert.equal(latest.retained, true);
      assert.equal(latest.lastReceivedAt.toISOString(), at.toISOString());
      assert.equal((await model.findMaster('master01')).lastSeenAt.toISOString(), before.lastSeenAt.toISOString());
    });
    await t.test('crash-left pending commands expire without replay', async () => {
      const record = await model.createCommand(await model.findMaster('master01'), 2, 'OFF', null);
      await db.query("UPDATE iot_device_commands SET expires_at=now()-interval '1 second' WHERE id=$1", [record.commandId]);
      assert.equal((await model.findCommand(record.commandId)).status, 'TIMED_OUT');
    });
  } finally {
    if (oldDb) require.cache[dbPath] = oldDb; else delete require.cache[dbPath];
    if (oldModel) require.cache[modelPath] = oldModel; else delete require.cache[modelPath];
    await db.close();
  }
});
