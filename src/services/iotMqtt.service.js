const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const mqtt = require('mqtt');
const getConfig = require('../config/iot');
const model = require('../models/iot.model');
const { parseMessage, masterId, integer, action } = require('../utils/iot-protocol');
const AppError = require('../utils/app-error');
const trace = require('../utils/iot-trace');

const TOPICS = ['smartmush/+/node/+/sensor/+', 'smartmush/+/status', 'smartmush/+/ssr/+/state'];

function createMqttService({ connect = mqtt.connect, repository = model, config = getConfig,
  logger = console, timeoutMs = 5000, now = () => performance.now() } = {}) {
  let client;
  let stopping = false;
  let ready = false;
  let maintenance;
  // Separate bounded lanes: sensor backlog must not delay or reject SSR feedback.
  // Serial SSR writes preserve ON/OFF arrival order, including equal timestamps.
  const lanes = {
    telemetry: { tail: Promise.resolve(), queued: 0 },
    ssr: { tail: Promise.resolve(), queued: 0 },
  };
  const drain = () => Promise.all(Object.values(lanes).map((lane) => lane.tail));
  const pending = new Set();
  const packetIds = new Set();

  function cancelPending() {
    ready = false;
    // MQTT.js otherwise retransmits unacknowledged QoS 1 packets on reconnect.
    for (const id of [...packetIds]) client.removeOutgoingMessage(id);
    packetIds.clear();
    for (const cancel of [...pending]) cancel(new AppError('MQTT connection lost; delivery unknown', 503));
  }

  function start() {
    if (client || stopping) return client;
    const settings = config();
    if (!settings.host) { logger.info('MQTT disabled: MQTT_HOST is not configured'); return null; }
    client = connect({ protocol: 'mqtts', host: settings.host, servername: settings.host, port: settings.port,
      username: settings.username, password: settings.password,
      clientId: `${settings.clientId}-${randomUUID()}`, rejectUnauthorized: true,
      protocolVersion: 5, clean: true, reconnectPeriod: 2000, connectTimeout: 10000,
      queueQoSZero: false, resubscribe: false,
      properties: { sessionExpiryInterval: 0, maximumPacketSize: 8192 } });
    client.on('packetsend', (packet) => {
      if (packet.cmd === 'publish' && packet.qos === 1) packetIds.add(packet.messageId);
    });
    client.on('packetreceive', (packet) => {
      if (packet.cmd === 'puback') packetIds.delete(packet.messageId);
    });
    client.on('connect', () => {
      ready = true;
      logger.info('MQTT connected');
      client.subscribe(TOPICS, { qos: 1 }, (error, granted) => {
        if (error || !granted || granted.some((item) => item.qos > 2)) logger.error('MQTT subscription failed');
        else logger.info('MQTT subscriptions ready');
      });
    });
    client.on('reconnect', () => logger.info('MQTT reconnecting'));
    client.on('offline', cancelPending);
    client.on('close', () => { cancelPending(); logger.info('MQTT disconnected'); });
    client.on('error', () => logger.error('MQTT connection error')); // Never log broker errors containing credentials.
    client.on('message', (topic, payload, packet = {}) => {
      const receivedAt = new Date();
      const receivedTick = now();
      let message;
      try { message = parseMessage(topic, payload); }
      catch { logger.warn('MQTT message rejected: invalid topic or payload'); return; }
      const isSsr = message.type === 'ssr';
      const lane = isSsr ? lanes.ssr : lanes.telemetry;
      const context = isSsr ? { feedbackId: randomUUID(), masterId: message.master,
        channel: message.channel, state: message.state, receivedAt: receivedAt.toISOString(),
        retained: Boolean(packet.retain) } : undefined;
      if (isSsr) trace(logger, 'ssr.mqtt.received', { ...context,
        ssrQueued: lanes.ssr.queued, telemetryQueued: lanes.telemetry.queued });
      if (stopping || lane.queued >= 1000) {
        logger.warn('MQTT ingestion capacity exceeded');
        if (isSsr) trace(logger, 'ssr.feedback.dropped', { ...context, stopping });
        return;
      }
      lane.queued += 1;
      lane.tail = lane.tail.then(async () => {
        if (isSsr) trace(logger, 'ssr.db.start', { ...context, queueWaitMs: now() - receivedTick });
        const accepted = await repository.receive(message, receivedAt, Boolean(packet.retain),
          isSsr ? { logger, context } : undefined);
        if (isSsr) trace(logger, accepted ? 'ssr.db.committed' : 'ssr.db.ignored',
          { ...context, receiveToCommitMs: now() - receivedTick });
        if (!accepted) logger.warn('MQTT message ignored: unregistered master');
      }).catch(() => {
        logger.error('MQTT persistence failed');
        if (isSsr) trace(logger, 'ssr.db.failed', context);
      }).finally(() => { lane.queued -= 1; });
    });
    maintenance = setInterval(() => repository.expireCommands().catch(() => logger.error('IoT command expiry failed')), 5000);
    maintenance.unref();
    return client;
  }

  // Internal deadline uses the process monotonic clock, never a database timestamp.
  function publish(master, channel, value, deadline = now() + timeoutMs) {
    masterId(master); integer(channel, 'channel', 1, 8); action(value);
    if (stopping || !ready || !client || !client.connected || client.disconnecting) {
      return Promise.reject(new AppError('MQTT is unavailable', 503));
    }
    const remaining = Math.min(timeoutMs, deadline - now());
    if (!(remaining > 0)) return Promise.reject(new AppError('Command publication timed out', 504));
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      let messageId;
      const capture = (packet) => {
        if (packet.cmd === 'publish') messageId = packet.messageId;
      };
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(finish);
        if (messageId !== undefined) {
          packetIds.delete(messageId);
          if (error) client.removeOutgoingMessage(messageId);
        }
        if (error) reject(error instanceof AppError ? error : new AppError('MQTT publication failed; delivery may be unknown', 503));
        else resolve();
      };
      pending.add(finish);
      timer = setTimeout(() => {
        ready = false;
        finish(new AppError('Command publication timed out; delivery unknown', 504));
        // Drop transport buffers too; bytes already delivered cannot be recalled.
        client.stream?.destroy();
      }, remaining);
      client.on('packetsend', capture);
      try {
        client.publish(`smartmush/${master}/ssr/${channel}/set`, value,
          { qos: 1, retain: false, properties: { messageExpiryInterval: Math.max(1, Math.floor(remaining / 1000)) } },
          (error, packet) => finish(error || (packet?.reasonCode >= 128 ? new Error('Broker rejected publication') : null)));
      } catch (error) { finish(error); }
      finally { client.removeListener('packetsend', capture); }
    });
  }

  async function stop() {
    stopping = true;
    clearInterval(maintenance);
    if (client) {
      cancelPending();
      await new Promise((resolve) => client.end(true, {}, resolve));
    }
    await drain();
  }
  return { start, stop, publish, drain, isReady: () => !!(ready && client?.connected && !client.disconnecting && !stopping) };
}

module.exports = { ...createMqttService(), createMqttService, TOPICS };
