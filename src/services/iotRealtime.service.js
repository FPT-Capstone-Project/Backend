const { emitToRoom } = require('../socket');

const EVENT_BY_TYPE = Object.freeze({
  sensor: 'iot:sensor.updated',
  status: 'iot:master.status.updated',
  ssr: 'iot:ssr.state.updated',
});

function createIotRealtimeService({ emit = emitToRoom, logger = console } = {}) {
  function publish(roomId, message, receivedAt, retained) {
    const id = Number(roomId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new TypeError('roomId must be a positive integer');
    }
    const event = EVENT_BY_TYPE[message?.type];
    if (!event) throw new TypeError('Unsupported IoT message type');
    if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) {
      throw new TypeError('receivedAt must be a valid Date');
    }
    if (typeof message.master !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(message.master)
      || typeof retained !== 'boolean') {
      throw new TypeError('Invalid IoT event metadata');
    }

    const payload = {
      masterId: message.master,
      receivedAt: receivedAt.toISOString(),
      retained: Boolean(retained),
    };
    if (message.type === 'sensor') {
      if (!Number.isSafeInteger(message.node) || message.node < 1 || message.node > 247
        || !Number.isSafeInteger(message.sensor) || message.sensor < 1 || message.sensor > 3
        || typeof message.ok !== 'boolean'
        || (message.ok && (typeof message.temperature !== 'number'
          || !Number.isFinite(message.temperature) || message.temperature < -40 || message.temperature > 125
          || typeof message.humidity !== 'number' || !Number.isFinite(message.humidity)
          || message.humidity < 0 || message.humidity > 100))
        || (!message.ok && (message.temperature !== null || message.humidity !== null))) {
        throw new TypeError('Invalid IoT sensor event payload');
      }
      Object.assign(payload, {
        nodeId: message.node,
        sensorId: message.sensor,
        ok: message.ok,
        temperature: message.temperature,
        humidity: message.humidity,
      });
    } else if (message.type === 'status') {
      if (!['online', 'offline'].includes(message.status)) {
        throw new TypeError('Invalid IoT master status event payload');
      }
      payload.status = message.status;
    } else {
      if (!Number.isSafeInteger(message.channel) || message.channel < 1 || message.channel > 8
        || !['ON', 'OFF'].includes(message.state)) {
        throw new TypeError('Invalid IoT SSR event payload');
      }
      payload.channel = message.channel;
      payload.state = message.state;
    }

    try {
      emit(id, event, payload);
    } catch (error) {
      logger.error('Không thể phát sự kiện IoT realtime:', error);
    }
  }

  return { publish };
}

module.exports = { ...createIotRealtimeService(), createIotRealtimeService };
