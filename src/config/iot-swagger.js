// Kept separate to avoid expanding the existing business-module schemas.
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const timestamp = { type: 'string', format: 'date-time', nullable: true };
const state = { type: 'string', enum: ['ON', 'OFF'], nullable: true };
const sensor = {
  nodeId: { type: 'integer', minimum: 1, maximum: 247 },
  sensorId: { type: 'integer', minimum: 1, maximum: 3 },
  temperature: { type: 'number', nullable: true }, humidity: { type: 'number', nullable: true },
  ok: { type: 'boolean' }, lastReceivedAt: timestamp, lastValidAt: timestamp,
  measuredAt: { ...timestamp, description: 'Always null: firmware supplies no measurement timestamp.' },
  retained: { type: 'boolean' },
};
const schemas = {
  IotMaster: { type: 'object', properties: {
    id: { type: 'integer' }, masterId: { type: 'string', example: 'master01' },
    cultivationRoomId: { type: 'integer', nullable: true },
    light_ssr_channel: { type: 'integer', minimum: 1, maximum: 8, nullable: true, description: 'Room light SSR channel; null means unconfigured. Channel 3 maps to GPIO6.' },
    reportedStatus: { type: 'string', enum: ['online', 'offline'], nullable: true },
    lastSeenAt: { ...timestamp, description: 'Last non-retained message arrival; not a connectivity guarantee.' },
    statusReceivedAt: timestamp, statusRetained: { type: 'boolean', nullable: true },
  } },
  IotSensor: { type: 'object', properties: { masterId: { type: 'string' }, ...sensor } },
  IotSensors: { type: 'object', properties: { masterId: { type: 'string' }, sensors: { type: 'array', items: ref('IotSensor') } } },
  IotHistory: { type: 'object', properties: {
    masterId: { type: 'string' }, nodeId: sensor.nodeId, sensorId: sensor.sensorId,
    limit: { type: 'integer' }, offset: { type: 'integer' },
    readings: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, temperature: sensor.temperature, humidity: sensor.humidity,
      ok: sensor.ok, receivedAt: timestamp, measuredAt: sensor.measuredAt, retained: sensor.retained,
    } } },
  } },
  IotSsr: { type: 'object', properties: { masterId: { type: 'string' }, channels: {
    type: 'array', minItems: 8, maxItems: 8, items: { type: 'object', properties: {
      channel: { type: 'integer', minimum: 1, maximum: 8 }, desiredState: state, reportedState: state,
      lastCommandAt: timestamp, lastReportedAt: timestamp, reportedRetained: { type: 'boolean', nullable: true },
      statesMatch: { type: 'boolean', nullable: true, description: 'Value comparison only; not command acknowledgment or physical verification.' },
    } },
  } } },
  IotCommand: { type: 'object', properties: {
    commandId: { type: 'string', format: 'uuid' }, masterId: { type: 'string' },
    channel: { type: 'integer', minimum: 1, maximum: 8 }, action: { type: 'string', enum: ['ON', 'OFF'] },
    status: { type: 'string', enum: ['PENDING', 'PUBLISHED', 'FAILED', 'TIMED_OUT'] },
    requestedBy: { type: 'integer', nullable: true }, requestedAt: timestamp, expiresAt: timestamp,
    publishedAt: timestamp, completedAt: timestamp, errorMessage: { type: 'string', nullable: true },
  } },
};
const params = {
  masterId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$', example: 'master01' },
  nodeId: { ...sensor.nodeId, example: 1 }, sensorId: { ...sensor.sensorId, example: 1 },
  channel: { type: 'integer', minimum: 1, maximum: 8, example: 1 },
  commandId: { type: 'string', format: 'uuid' },
};
function operation(summary, pathParams, data, control = false) {
  const responses = {};
  for (const [code, description] of Object.entries({ 400: 'Invalid input', 401: 'Missing or invalid JWT',
    404: 'Resource not found', 500: 'Database or server error',
    ...(control ? { 409: 'Channel publication in progress', 503: 'MQTT unavailable or publication failed', 504: 'Publication deadline elapsed; delivery unknown' } : {}) })) {
    responses[code] = { description, content: { 'application/json': { schema: ref('Error') } } };
  }
  responses[control ? 202 : 200] = { description: control ? 'Broker accepted publication; physical state is unverified' : 'Success',
    content: { 'application/json': { schema: { type: 'object', properties: { data } } } } };
  return { tags: ['IoT'], summary, security: [{ bearerAuth: [] }],
    description: control ? 'Requires a valid JWT for any active user, including customers. No role or user allowlist is applied. MQTT credentials authenticate the backend to the broker, not the API caller. Publishes plain ON/OFF, QoS 1, retain false, with a five-second deadline. PUBLISHED means broker PUBACK only. No command IDs in firmware feedback; matching state cannot acknowledge this command. Do not automatically retry failures/timeouts.'
      : 'Requires an active authenticated user, matching cultivation-room read access. Timestamps describe backend arrival. Retained online status may be stale. Command completion timestamps describe publication attempts, not actuation.',
    parameters: pathParams.map((name) => ({ in: 'path', name, required: true, schema: params[name] })), responses };
}
const base = '/api/iot';
const path = `${base}/masters/{masterId}/nodes/{nodeId}/sensors/{sensorId}`;
const paths = {
  [`${base}/masters`]: { get: operation('List registered masters', [], { type: 'array', items: ref('IotMaster') }) },
  [`${base}/masters/{masterId}/sensors`]: { get: operation('Latest sensors, preserving last valid values on failure', ['masterId'], ref('IotSensors')) },
  [path]: { get: operation('Get latest sensor state', ['masterId', 'nodeId', 'sensorId'], ref('IotSensor')) },
  [`${path}/history`]: { get: operation('Sensor history ordered by receivedAt descending', ['masterId', 'nodeId', 'sensorId'], ref('IotHistory')) },
  [`${base}/masters/{masterId}/ssr`]: { get: operation('All eight SSR channels; unreported values are null', ['masterId'], ref('IotSsr')) },
  [`${base}/masters/{masterId}/ssr/{channel}/commands`]: { post: {
    ...operation('Request manual SSR ON/OFF', ['masterId', 'channel'], ref('IotCommand'), true),
    requestBody: { required: true, content: { 'application/json': { schema: {
      type: 'object', required: ['action'], properties: { action: { type: 'string', enum: ['ON', 'OFF'] } },
    }, example: { action: 'ON' } } } },
  } },
  [`${base}/commands/{commandId}`]: { get: operation('Persisted command publication status (no correlated acknowledgment)', ['commandId'], ref('IotCommand')) },
};
paths[`${base}/masters/{masterId}/light`] = { put: {
  ...operation('Configure the shared room light channel', ['masterId'], ref('IotMaster')),
  description: 'Requires iot.automation.manage. Master must belong to a room. Rejects channels assigned to floor valves. Null removes the mapping. Does not switch relays or publish MQTT.',
  requestBody: { required: true, content: { 'application/json': { schema: {
    type: 'object', additionalProperties: false, required: ['channel'],
    properties: { channel: { type: 'integer', minimum: 1, maximum: 8, nullable: true } },
  }, example: { channel: 3 } } } },
} };
Object.assign(paths[`${base}/masters/{masterId}/light`].put.responses, {
  403: { description: 'Missing iot.automation.manage permission' },
  409: { description: 'Master has no room or channel is assigned to a floor valve' },
});
paths[`${path}/history`].get.parameters.push(...Object.entries({
  from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' },
  limit: { type: 'integer', minimum: 1, maximum: 1000, default: 100 },
  offset: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 },
}).map(([name, schema]) => ({ name, in: 'query', schema })));

module.exports = { schemas, paths };
