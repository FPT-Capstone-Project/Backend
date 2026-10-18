const model = require('../models/iot.model');
const mqtt = require('./iotMqtt.service');
const validate = require('../utils/iot-protocol');
const AppError = require('../utils/app-error');
const { performance } = require('node:perf_hooks');
const trace = require('../utils/iot-trace');
const { randomUUID } = require('node:crypto');

function createIotService(repository = model, publisher = mqtt, { now = () => performance.now(), logger = console } = {}) {
  const activeChannels = new Set();
  async function master(identifier) {
    const found = await repository.findMaster(validate.masterId(identifier));
    if (!found) throw new AppError('IoT master not found', 404);
    return found;
  }
  function address(node, sensor) {
    return [validate.integer(node, 'nodeId', 1, 247), validate.integer(sensor, 'sensorId', 1, 3)];
  }
  function date(value, name) {
    if (value === undefined) return null;
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
        || !Number.isFinite(Date.parse(value))) throw new AppError(`${name} must be an ISO timestamp with timezone`, 400);
    return new Date(value);
  }
  return {
    listMasters: () => repository.findMasters(),
    async sensors(id) { const m = await master(id); return { masterId: id, sensors: await repository.findSensors(m.id) }; },
    async sensor(id, node, sensor) {
      const args = address(node, sensor);
      const m = await master(id);
      const found = await repository.findSensor(m.id, ...args);
      if (!found) throw new AppError('IoT sensor not found', 404);
      return { masterId: id, ...found };
    },
    async history(id, node, sensor, query = {}) {
      const args = address(node, sensor);
      const from = date(query.from, 'from'); const to = date(query.to, 'to');
      if (from && to && from > to) throw new AppError('from must not be after to', 400);
      const limit = validate.integer(query.limit ?? 100, 'limit', 1, 1000);
      const offset = validate.integer(query.offset ?? 0, 'offset', 0, 1000000);
      const m = await master(id);
      return { masterId: id, nodeId: args[0], sensorId: args[1], limit, offset,
        readings: await repository.history(m.id, ...args, { from, to, limit, offset }) };
    },
    async ssr(id) {
      validate.masterId(id);
      const context = { readId: randomUUID(), masterId: id };
      const started = now();
      trace(logger, 'ssr.get.start', context);
      const m = await master(id);
      const channels = await repository.findSsr(m.id);
      trace(logger, 'ssr.get.done', { ...context, durationMs: now() - started,
        channels: channels.map(({ channel, desiredState, reportedState, lastReportedAt }) =>
          ({ channel, desiredState, reportedState, lastReportedAt })) });
      return { masterId: id, channels };
    },
    async command(id) {
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw new AppError('Invalid commandId', 400);
      }
      const found = await repository.findCommand(id);
      if (!found) throw new AppError('IoT command not found', 404);
      return found;
    },
    async control(id, channel, body, userId, internal = {}) {
      const number = validate.integer(channel, 'channel', 1, 8);
      const value = validate.action(body?.action);
      const m = await master(id);
      const execute = async () => {
      if (repository === model && !internal.automatic) {
        await require('./autoMisting.service').manual(m.id, number, value, userId);
      }
      const key = `${id}/${number}`;
      if (activeChannels.has(key)) throw new AppError('A command is already being published for this channel', 409);
      activeChannels.add(key);
      try {
        // Include persistence time without comparing database and host wall clocks.
        const publicationDeadline = now() + (internal.maxPublishMs || 5000);
        if (internal.beforePublish) await internal.beforePublish();
        const record = await repository.createCommand(m, number, value, userId);
        const context = { commandId: record.commandId, masterId: id, channel: number, action: value };
        trace(logger, 'ssr.command.publish.start', context);
        const publishStarted = now();
        try {
          if (repository === model) require('../models/autoMisting.model').assertLockHealthy();
          if (internal.authorizePublish) internal.authorizePublish();
          await publisher.publish(id, number, value, publicationDeadline);
          trace(logger, 'ssr.command.publish.acked', { ...context, durationMs: now() - publishStarted });
        }
        catch (error) {
          await repository.finishCommand(record.commandId, error.statusCode === 504 ? 'TIMED_OUT' : 'FAILED',
            error.statusCode === 504 ? 'Publication timed out; delivery unknown' : 'Publication failed; delivery may be unknown');
          throw new AppError(`Command ${record.commandId}: ${error.statusCode === 504 ? 'publication timed out' : 'MQTT publication failed'}`, error.statusCode === 504 ? 504 : 503);
        }
        await repository.finishCommand(record.commandId, 'PUBLISHED');
        return repository.findCommand(record.commandId);
      } finally { activeChannels.delete(key); }
      };
      return repository === model && !internal.lockHeld
        ? require('../models/autoMisting.model').lockChannel(m.id, number, execute)
        : execute();
    },
  };
}

module.exports = { ...createIotService(), createIotService };
