const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { parseMessage } = require('../src/utils/iot-protocol');
const { createMqttService, TOPICS } = require('../src/services/iotMqtt.service');
const { createIotService } = require('../src/services/iot.service');

const sensorTopic = 'smartmush/master01/node/1/sensor/1';
const reading = { node_id: 1, sensor_id: 1, ok: true, temperature: 27.5, humidity: 85.2 };
const buffer = (value) => Buffer.from(JSON.stringify(value));
const silent = { info() {}, warn() {}, error() {} };

class MockMqtt extends EventEmitter {
  connected = true;
  publications = [];
  subscriptions = [];
  outgoing = new Map();
  counter = 0;
  mode = 'success';
  subscribe(topics, options, callback) {
    this.subscriptions.push({ topics, options });
    callback(null, topics.map((topic) => ({ topic, qos: 1 })));
  }
  publish(topic, payload, options, callback) {
    const id = ++this.counter;
    this.publications.push({ topic, payload, options });
    this.outgoing.set(id, callback);
    this.emit('packetsend', { cmd: 'publish', qos: options.qos, messageId: id });
    if (this.mode === 'wait') return;
    this.outgoing.delete(id);
    if (this.mode === 'failure') callback(new Error('broker failure with sensitive data'));
    else {
      this.emit('packetreceive', { cmd: 'puback', messageId: id });
      callback(null, { reasonCode: this.mode === 'denied' ? 135 : 0 });
    }
  }
  removeOutgoingMessage(id) {
    const callback = this.outgoing.get(id);
    this.outgoing.delete(id);
    if (callback) callback(new Error('Message removed'));
  }
  end(force, options, callback) { this.connected = false; callback(); }
}
function harness(overrides = {}) {
  const client = new MockMqtt();
  let connections = 0; let options;
  const messages = [];
  const repository = { receive: async (...args) => { messages.push(args); return true; }, expireCommands: async () => {}, ...overrides.repository };
  const service = createMqttService({ connect: (opts) => { connections += 1; options = opts; return client; },
    config: () => ({ host: 'example.com', port: 8883, clientId: 'test' }), repository, logger: overrides.logger || silent,
    timeoutMs: overrides.timeoutMs || 1000, now: overrides.now });
  service.start();
  client.emit('connect');
  return { client, service, messages, get connections() { return connections; }, get options() { return options; } };
}

test('sensor parsing accepts successful/failed polls and multiple node addresses', () => {
  assert.equal(parseMessage(sensorTopic, buffer(reading)).temperature, 27.5);
  const failed = parseMessage(sensorTopic, buffer({ ...reading, ok: false, temperature: null, humidity: null }));
  assert.equal(failed.temperature, null); assert.equal(failed.ok, false);
  for (const node of [1, 2, 247]) for (const sensor of [1, 2, 3]) {
    const parsed = parseMessage(`smartmush/master02/node/${node}/sensor/${sensor}`, buffer({ ...reading, node_id: node, sensor_id: sensor }));
    assert.equal(parsed.node, node); assert.equal(parsed.sensor, sensor);
  }
});
test('rejects invalid topics, JSON, types, ranges, missing readings and inconsistent IDs', () => {
  for (const topic of ['x/master01/node/1/sensor/1', 'smartmush/+/node/1/sensor/1', 'smartmush/master01/node/0/sensor/1', `${sensorTopic}/extra`]) {
    assert.throws(() => parseMessage(topic, buffer(reading)));
  }
  assert.throws(() => parseMessage(sensorTopic, Buffer.from('{')));
  for (const changes of [{ node_id: 2 }, { sensor_id: '1' }, { temperature: null }, { humidity: 101 },
    { temperature: -41 }, { ok: 'true' }, { ok: false }, { temperature: undefined }]) {
    assert.throws(() => parseMessage(sensorTopic, buffer({ ...reading, ...changes })));
  }
  assert.throws(() => parseMessage(sensorTopic, Buffer.alloc(2049)));
});
test('one client and one set of handlers across reconnect; resubscribes every connection', async () => {
  const h = harness();
  try {
    assert.equal(h.service.start(), h.client);
    for (let i = 0; i < 3; i += 1) h.client.emit('connect');
    assert.equal(h.connections, 1); assert.equal(h.client.listenerCount('message'), 1);
    assert.equal(h.client.listenerCount('connect'), 1);
    assert.equal(h.client.subscriptions.length, 4);
    assert.deepEqual(h.client.subscriptions[0].topics, TOPICS);
    assert.equal(h.options.rejectUnauthorized, true); assert.equal(h.options.protocolVersion, 5);
    assert.equal(h.options.queueQoSZero, false); assert.equal(h.options.resubscribe, false);
    assert.match(h.options.clientId, /^test-.+/);
    h.client.emit('message', sensorTopic, Buffer.from('{'), {});
    h.client.emit('message', sensorTopic, buffer(reading), { retain: true });
    await h.service.drain();
    assert.equal(h.messages.length, 1); assert.ok(h.messages[0][1] instanceof Date); assert.equal(h.messages[0][2], true);
  } finally { await h.service.stop(); }
});
test('publishes plain ON/OFF on exact firmware topic, QoS 1, no retention and short expiry', async () => {
  const h = harness();
  try {
    for (const action of ['ON', 'OFF']) await h.service.publish('master01', 1, action);
    assert.deepEqual(h.client.publications.map((p) => p.payload), ['ON', 'OFF']);
    for (const p of h.client.publications) {
      assert.equal(p.topic, 'smartmush/master01/ssr/1/set');
      assert.equal(p.options.retain, false); assert.equal(p.options.qos, 1);
      assert.ok(p.options.properties.messageExpiryInterval <= 5);
    }
    h.client.connected = false;
    await assert.rejects(h.service.publish('master01', 1, 'ON'), { statusCode: 503 });
    assert.equal(h.client.publications.length, 2);
  } finally { await h.service.stop(); }
});
test('disconnect discards unacknowledged commands and does not replay on reconnect', async () => {
  const h = harness();
  try {
    h.client.mode = 'wait';
    const pending = h.service.publish('master01', 1, 'ON');
    const rejected = assert.rejects(pending, { statusCode: 503 });
    h.client.connected = false; h.client.emit('close');
    await rejected;
    assert.equal(h.client.outgoing.size, 0);
    h.client.connected = true; h.client.emit('connect');
    assert.equal(h.client.publications.length, 1);
  } finally { await h.service.stop(); }
});
test('publication failure, negative PUBACK and timeout reject without retained outgoing packets', async () => {
  const h = harness({ timeoutMs: 15 });
  try {
    for (const mode of ['failure', 'denied', 'wait']) {
      h.client.mode = mode;
      await assert.rejects(h.service.publish('master01', 2, 'ON'), { statusCode: mode === 'wait' ? 504 : 503 });
      assert.equal(h.client.outgoing.size, 0);
    }
  } finally { await h.service.stop(); }
});
test('SSR reports persist independently and bad persistence does not break later messages', async () => {
  let calls = 0;
  const h = harness({ repository: { receive: async () => { calls += 1; if (calls === 1) throw new Error('db'); return true; } } });
  try {
    h.client.emit('message', 'smartmush/master01/ssr/8/state', Buffer.from('ON'));
    h.client.emit('message', 'smartmush/master01/status', Buffer.from('offline'));
    await h.service.drain(); assert.equal(calls, 2);
    assert.deepEqual(parseMessage('smartmush/master01/ssr/8/state', Buffer.from('OFF')),
      { type: 'ssr', master: 'master01', channel: 8, state: 'OFF' });
  } finally { await h.service.stop(); }
});

test('SSR commits while telemetry lane is full and blocked; logs receipt before persistence', { timeout: 3000 }, async () => {
  let releaseSensor;
  const blocked = new Promise((resolve) => { releaseSensor = resolve; });
  const stored = []; const logs = [];
  const h = harness({ logger: { ...silent, info: (line) => { if (line.startsWith('{')) logs.push(JSON.parse(line)); } },
    repository: { receive: async (message) => {
      if (message.type === 'sensor') await blocked;
      stored.push(message);
      return true;
    } } });
  try {
    for (let i = 0; i < 1000; i += 1) h.client.emit('message', sensorTopic, buffer(reading));
    h.client.emit('message', 'smartmush/master01/ssr/1/state', Buffer.from('ON'));
    h.client.emit('message', 'smartmush/master01/ssr/1/state', Buffer.from('OFF'));
    assert.equal(logs.at(-1).event, 'ssr.mqtt.received');
    assert.equal(logs.at(-1).telemetryQueued, 1000);
    await new Promise(setImmediate);
    assert.deepEqual(stored.map((m) => m.state), ['ON', 'OFF']);
    assert.deepEqual(logs.filter((entry) => entry.event).map((entry) => entry.event),
      ['ssr.mqtt.received', 'ssr.mqtt.received', 'ssr.db.start', 'ssr.db.committed', 'ssr.db.start', 'ssr.db.committed']);
    assert.ok(logs.every((entry) => Number.isFinite(Date.parse(entry.at))));
    assert.equal(new Set(logs.map((entry) => entry.feedbackId)).size, 2);
  } finally { releaseSensor(); await h.service.stop(); }
});

test('SSR lane preserves order, recovers after failure and shutdown waits for feedback', { timeout: 3000 }, async () => {
  let releaseFeedback;
  const blocked = new Promise((resolve) => { releaseFeedback = resolve; });
  const started = []; const stored = [];
  const h = harness({ repository: { receive: async (message) => {
    started.push(message.state);
    if (started.length === 1) { await blocked; throw new Error('temporary DB failure'); }
    stored.push(message.state);
    return true;
  } } });
  try {
    h.client.emit('message', 'smartmush/master01/ssr/1/state', Buffer.from('ON'));
    h.client.emit('message', 'smartmush/master01/ssr/1/state', Buffer.from('OFF'));
    await new Promise(setImmediate);
    assert.deepEqual(started, ['ON']);
    let stopped = false;
    const stopping = h.service.stop().then(() => { stopped = true; });
    await new Promise(setImmediate);
    assert.equal(stopped, false);
    releaseFeedback();
    await stopping;
    assert.deepEqual(started, ['ON', 'OFF']);
    assert.deepEqual(stored, ['OFF']);
  } finally { releaseFeedback(); await h.service.stop(); }
});

function serviceHarness({ exists = true, publishError } = {}) {
  let command; const published = [];
  const repository = {
    findMaster: async () => exists ? { id: 1 } : null,
    createCommand: async (master, channel, action, userId) => {
      command = { commandId: 'a'.repeat(8) + '-aaaa-aaaa-aaaa-aaaaaaaaaaaa', channel, action,
        requestedBy: userId, status: 'PENDING', expiresAt: new Date(Date.now() + 5000) };
      return command;
    },
    finishCommand: async (id, status) => { command.status = status; },
    findCommand: async () => command,
    history: async (...args) => args,
  };
  const service = createIotService(repository, { publish: async (...args) => { published.push(args); if (publishError) throw publishError; } });
  return { service, published, get command() { return command; } };
}
test('commands persist publication status without interpreting feedback as acknowledgment', async () => {
  const h = serviceHarness();
  const result = await h.service.control('master01', '1', { action: 'ON' }, 5);
  assert.equal(result.status, 'PUBLISHED'); assert.equal(result.requestedBy, 5);
  assert.deepEqual(h.published[0].slice(0, 3), ['master01', 1, 'ON']);
  assert.equal(result.reportedState, undefined);
});
test('invalid channel/action and unknown master are rejected before creating/publishing commands', async () => {
  const h = serviceHarness();
  for (const channel of [0, 9, 1.5, '1e0']) await assert.rejects(h.service.control('master01', channel, { action: 'ON' }, 5), { statusCode: 400 });
  for (const action of ['on', 'OFF ', true, null]) await assert.rejects(h.service.control('master01', 1, { action }, 5), { statusCode: 400 });
  const missing = serviceHarness({ exists: false });
  await assert.rejects(missing.service.control('master02', 1, { action: 'ON' }, 5), { statusCode: 404 });
  assert.equal(h.command, undefined); assert.equal(missing.published.length, 0);
});
test('failed publication and timeout are persisted', async () => {
  for (const code of [503, 504]) {
    const h = serviceHarness({ publishError: { statusCode: code } });
    await assert.rejects(h.service.control('master01', 1, { action: 'OFF' }, 5), { statusCode: code });
    assert.equal(h.command.status, code === 504 ? 'TIMED_OUT' : 'FAILED');
  }
});
test('database clock skew does not cause premature timeout or extend the publication budget', async () => {
  for (const skew of [-14000, 14000]) {
    let elapsed = 100;
    let command;
    const h = harness({ timeoutMs: 5000, now: () => elapsed });
    const repository = {
      findMaster: async () => ({ id: 1 }),
      createCommand: async () => {
        elapsed += 400;
        command = { commandId: 'test', expiresAt: new Date(Date.now() + skew + 5000), status: 'PENDING' };
        return command;
      },
      finishCommand: async (id, status) => { command.status = status; },
      findCommand: async () => command,
    };
    try {
      const service = createIotService(repository, h.service, { now: () => elapsed });
      assert.equal((await service.control('master01', 1, { action: 'ON' }, 7)).status, 'PUBLISHED');
      assert.equal(h.client.publications.length, 1);
      assert.equal(h.client.publications[0].options.properties.messageExpiryInterval, 4);
    } finally { await h.service.stop(); }
  }
});
test('persistence consuming the five-second budget times out without publishing or retrying', async () => {
  let elapsed = 100;
  let status;
  const h = harness({ timeoutMs: 5000, now: () => elapsed });
  const repository = {
    findMaster: async () => ({ id: 1 }),
    createCommand: async () => {
      elapsed += 5001;
      return { commandId: 'test', expiresAt: new Date(Date.now() + 60000) };
    },
    finishCommand: async (id, value) => { status = value; },
  };
  try {
    const service = createIotService(repository, h.service, { now: () => elapsed });
    await assert.rejects(service.control('master01', 1, { action: 'ON' }, 7), { statusCode: 504 });
    assert.equal(status, 'TIMED_OUT');
    assert.equal(h.client.publications.length, 0);
  } finally { await h.service.stop(); }
});
test('history input is bounded and timestamps require timezones', async () => {
  const h = serviceHarness();
  for (const query of [{ limit: 1001 }, { offset: -1 }, { from: '2026-10-16' }, { from: '2026-10-16T10:00:00Z', to: '2026-10-15T10:00:00Z' }]) {
    await assert.rejects(h.service.history('master01', 1, 1, query), { statusCode: 400 });
  }
  const result = await h.service.history('master01', 1, 1);
  assert.equal(result.limit, 100); assert.equal(result.offset, 0);
});
