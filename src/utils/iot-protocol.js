const AppError = require('./app-error');

function masterId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new AppError('Invalid masterId', 400);
  }
  return value;
}

function integer(value, name, min, max) {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value))
      || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new AppError(`${name} must be an integer from ${min} to ${max}`, 400);
  }
  return Number(value);
}

function action(value) {
  if (value !== 'ON' && value !== 'OFF') throw new AppError('action must be ON or OFF', 400);
  return value;
}

function parseMessage(topic, payload) {
  if (typeof topic !== 'string' || payload.length > 2048) throw new Error('Invalid MQTT message');
  const parts = topic.split('/');
  if (parts[0] !== 'smartmush') throw new Error('Invalid MQTT topic');
  const master = masterId(parts[1]);
  const text = payload.toString('utf8');
  if (parts.length === 3 && parts[2] === 'status') {
    if (!['online', 'offline'].includes(text)) throw new Error('Invalid master status');
    return { type: 'status', master, status: text };
  }
  if (parts.length === 5 && parts[2] === 'ssr' && parts[4] === 'state') {
    return { type: 'ssr', master, channel: integer(parts[3], 'channel', 1, 8), state: action(text) };
  }
  if (parts.length !== 6 || parts[2] !== 'node' || parts[4] !== 'sensor') throw new Error('Invalid MQTT topic');
  const node = integer(parts[3], 'nodeId', 1, 247);
  const sensor = integer(parts[5], 'sensorId', 1, 3);
  const data = JSON.parse(text);
  if (!data || Array.isArray(data) || data.node_id !== node || data.sensor_id !== sensor
      || typeof data.ok !== 'boolean') throw new Error('Invalid sensor payload');
  if (data.ok) {
    if (typeof data.temperature !== 'number' || !Number.isFinite(data.temperature)
        || data.temperature < -40 || data.temperature > 125
        || typeof data.humidity !== 'number' || !Number.isFinite(data.humidity)
        || data.humidity < 0 || data.humidity > 100) throw new Error('Invalid measurement');
  } else if (data.temperature !== null || data.humidity !== null) throw new Error('Failed readings must be null');
  return { type: 'sensor', master, node, sensor, ok: data.ok, temperature: data.temperature, humidity: data.humidity };
}

module.exports = { masterId, integer, action, parseMessage };
