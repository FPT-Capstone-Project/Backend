const test = require('node:test');
const assert = require('node:assert/strict');
const { Duplex } = require('node:stream');
const { once } = require('node:events');
const mqtt = require('mqtt');
const wire = require('mqtt-packet'); // MQTT.js's wire codec; no broker/network required.
const { createMqttService } = require('../src/services/iotMqtt.service');

test('actual MQTT.js discards QoS 1 packets before reconnect and resubscribes without replay', { timeout: 5000 }, async () => {
  const streams = []; const packets = []; const received = [];
  let acknowledge = false; let client;
  const service = createMqttService({
    config: () => ({ host: 'mock', port: 8883, clientId: 'test' }),
    logger: { info() {}, warn() {}, error() {} },
    repository: { expireCommands: async () => {}, receive: async (...args) => { received.push(args); return true; } },
    connect: (options) => {
      client = new mqtt.MqttClient(() => {
        const parser = wire.parser({ protocolVersion: 5 });
        const stream = new Duplex({ read() {}, write(chunk, encoding, callback) { parser.parse(chunk); callback(); } });
        const reply = (packet) => setImmediate(() => { if (!stream.destroyed) stream.push(wire.generate(packet, { protocolVersion: 5 })); });
        parser.on('packet', (packet) => {
          packets.push(packet);
          if (packet.cmd === 'connect') reply({ cmd: 'connack', reasonCode: 0, sessionPresent: false });
          if (packet.cmd === 'subscribe') reply({ cmd: 'suback', messageId: packet.messageId, granted: packet.subscriptions.map(() => 1) });
          if (packet.cmd === 'publish' && acknowledge) reply({ cmd: 'puback', messageId: packet.messageId, reasonCode: 0 });
        });
        streams.push(stream);
        return stream;
      }, { ...options, reconnectPeriod: 20 });
      return client;
    },
  });
  service.start();
  try {
    await once(client, 'connect');
    const feedback = once(client, 'message');
    streams[0].push(wire.generate({ cmd: 'publish', qos: 1, messageId: 42,
      topic: 'smartmush/master01/ssr/1/state', payload: Buffer.from('ON'), retain: false }, { protocolVersion: 5 }));
    await feedback;
    await service.drain();
    assert.deepEqual(received[0][0], { type: 'ssr', master: 'master01', channel: 1, state: 'ON' });
    assert.ok(received[0][1] instanceof Date);
    assert.equal(received[0][2], false);
    const publication = assert.rejects(service.publish('master01', 1, 'ON'), { statusCode: 503 });
    await new Promise(setImmediate); // Let MQTT.js flush its corked transport write.
    const reconnected = once(client, 'connect');
    streams[0].destroy();
    await publication; await reconnected;
    await new Promise(setImmediate);
    assert.equal(packets.filter((p) => p.cmd === 'publish').length, 1);
    assert.equal(packets.filter((p) => p.cmd === 'subscribe').length, 2);
    assert.equal(Object.keys(client.outgoing).filter((id) => client.outgoing[id].cmd === 'publish').length, 0);
    acknowledge = true;
    await service.publish('master01', 1, 'OFF');
    assert.deepEqual(packets.filter((p) => p.cmd === 'publish').map((p) => p.payload.toString()), ['ON', 'OFF']);
    assert.equal(client.listenerCount('message'), 1);
  } finally { await service.stop(); }
});
