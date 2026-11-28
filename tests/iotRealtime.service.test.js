const test = require('node:test');
const assert = require('node:assert/strict');
const { createIotRealtimeService } = require('../src/services/iotRealtime.service');

test('maps persisted MQTT sensor, master and SSR messages to safe room payloads', () => {
  const emitted = [];
  const realtime = createIotRealtimeService({
    emit: (...args) => emitted.push(args),
    logger: { error() {} },
  });
  const receivedAt = new Date('2026-11-28T05:30:00.000Z');

  realtime.publish(3, {
    type: 'sensor', master: 'master01', node: 1, sensor: 2,
    ok: true, temperature: 27.5, humidity: 85.2, secret: 'not forwarded',
  }, receivedAt, false);
  realtime.publish(3, { type: 'status', master: 'master01', status: 'online' }, receivedAt, true);
  realtime.publish(3, { type: 'ssr', master: 'master01', channel: 4, state: 'ON' }, receivedAt, false);

  assert.deepEqual(emitted, [
    [3, 'iot:sensor.updated', {
      masterId: 'master01',
      receivedAt: '2026-11-28T05:30:00.000Z',
      retained: false,
      nodeId: 1,
      sensorId: 2,
      ok: true,
      temperature: 27.5,
      humidity: 85.2,
    }],
    [3, 'iot:master.status.updated', {
      masterId: 'master01',
      receivedAt: '2026-11-28T05:30:00.000Z',
      retained: true,
      status: 'online',
    }],
    [3, 'iot:ssr.state.updated', {
      masterId: 'master01',
      receivedAt: '2026-11-28T05:30:00.000Z',
      retained: false,
      channel: 4,
      state: 'ON',
    }],
  ]);
});

test('rejects invalid routing data and logs delivery errors', () => {
  const errors = [];
  const realtime = createIotRealtimeService({
    emit: () => { throw new Error('socket unavailable'); },
    logger: { error: (...args) => errors.push(args) },
  });
  const message = { type: 'status', master: 'master01', status: 'offline' };

  assert.throws(() => realtime.publish(0, message, new Date(), false), /roomId/);
  assert.throws(() => realtime.publish(1, { type: 'unknown' }, new Date(), false), /message type/);
  assert.doesNotThrow(() => realtime.publish(1, message, new Date(), false));
  assert.equal(errors.length, 1);
});
