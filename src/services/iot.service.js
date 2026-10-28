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
    async configureLight(id, body) {
      if (!body || Array.isArray(body) || typeof body !== 'object'
          || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'channel')
          || (body.channel !== null && (!Number.isInteger(body.channel) || body.channel < 1 || body.channel > 8))) {
        throw new AppError('channel must be an integer from 1 to 8, or null', 400);
      }
      const m = await master(id);
      if (body.channel !== null && m.cultivationRoomId == null) {
        throw new AppError('Assign the master to a room before configuring its light', 409);
      }
      try {
        const updated = await repository.setLightChannel(m.id, body.channel);
        if (!updated) throw new AppError('IoT master not found', 404);
        return updated;
      } catch (error) {
        if (error.constraint === 'light_mapping_conflict') throw new AppError(error.message, 409);
        throw error;
      }
    },
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
        // Prerequisite checks precede the publication budget. Command persistence
        // still consumes it, and automation may cap it at the reserved pulse end.
        const prepared = internal.beforePublish ? await internal.beforePublish() : undefined;
        const publicationDeadline = Math.min(now() + (internal.maxPublishMs || 5000),
          prepared?.publicationDeadline ?? Infinity);
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
            error.statusCode === 504 ? 'Hết thời gian gửi lệnh; chưa xác định lệnh đã được chuyển đến thiết bị hay chưa' : 'Gửi lệnh thất bại; có thể chưa xác định được trạng thái chuyển lệnh');
          throw new AppError(`Lệnh ${record.commandId}: ${error.statusCode === 504 ? 'hết thời gian gửi lệnh' : 'gửi lệnh MQTT thất bại'}`, error.statusCode === 504 ? 504 : 503);
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
