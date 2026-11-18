const model = require('../models/cultivationEnvironmentHistory.model');
const AppError = require('../utils/app-error');
const { parsePagination } = require('../utils/pagination');

function parseId(value, field) {
  if (!/^[1-9]\d*$/.test(String(value ?? ''))) {
    throw new AppError(`${field} must be a positive integer`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AppError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}

function parseDateRange(query = {}) {
  const parseDate = (value, field) => {
    if (value === undefined) return null;
    if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
      throw new AppError(`${field} must be an ISO timestamp with a timezone`, 400);
    }
    return new Date(value);
  };
  const from = parseDate(query.from, 'from');
  const to = parseDate(query.to, 'to');
  if (from && to && from >= to) {
    throw new AppError('from must be earlier than to', 400);
  }
  return { from, to };
}

function paginationFor(result, pagination) {
  return {
    data: result.records,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pagination.pageSize),
    },
  };
}

async function assertSessionAccess(sessionId, user) {
  const roleId = Number(user?.role_id);
  if (![1, 2, 3].includes(roleId)) {
    throw new AppError('You do not have permission to access this resource', 403);
  }
  const session = await model.findSessionOwner(sessionId);
  if (!session || (roleId === 3 && Number(session.user_id) !== Number(user.user_id))) {
    throw new AppError('Cultivation session not found', 404);
  }
  return session;
}

async function getSessionHistory(rawSessionId, user, query = {}) {
  const sessionId = parseId(rawSessionId, 'sessionId');
  await assertSessionAccess(sessionId, user);
  const pagination = parsePagination(query);
  const filters = { ...parseDateRange(query), ...pagination };
  return paginationFor(await model.findSessionHistory(sessionId, filters), pagination);
}

async function getLatestSessionHistory(rawSessionId, user) {
  const sessionId = parseId(rawSessionId, 'sessionId');
  await assertSessionAccess(sessionId, user);
  return model.findLatestSessionHistory(sessionId);
}

async function getSessionReport(rawSessionId, user) {
  const sessionId = parseId(rawSessionId, 'sessionId');
  await assertSessionAccess(sessionId, user);
  const { session, records } = await model.findSessionReport(sessionId);
  if (!session) throw new AppError('Cultivation session not found', 404);

  const thresholds = {
    temperatureMin: session.temperature_min == null ? null : Number(session.temperature_min),
    temperatureMax: session.temperature_max == null ? null : Number(session.temperature_max),
    humidityMin: session.humidity_min == null ? null : Number(session.humidity_min),
    humidityMax: session.humidity_max == null ? null : Number(session.humidity_max),
  };
  const points = records.map((record) => ({
    period_start: record.period_start,
    period_end: record.period_end,
    growth_stage: record.growth_stage,
    temperature_avg: record.temperature_avg == null ? null : Number(record.temperature_avg),
    humidity_avg: record.humidity_avg == null ? null : Number(record.humidity_avg),
  }));
  const average = (key) => {
    const values = points.map((point) => point[key]).filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };
  const hasTemperatureThresholds = thresholds.temperatureMin != null && thresholds.temperatureMax != null;
  const hasHumidityThresholds = thresholds.humidityMin != null && thresholds.humidityMax != null;
  const temperatureExceedanceCount = hasTemperatureThresholds
    ? points.filter((point) => point.temperature_avg != null
      && (point.temperature_avg < thresholds.temperatureMin || point.temperature_avg > thresholds.temperatureMax)).length
    : null;
  const humidityExceedanceCount = hasHumidityThresholds
    ? points.filter((point) => point.humidity_avg != null
      && (point.humidity_avg < thresholds.humidityMin || point.humidity_avg > thresholds.humidityMax)).length
    : null;
  const exceededBuckets = points.filter((point) => (
    (hasTemperatureThresholds && point.temperature_avg != null
      && (point.temperature_avg < thresholds.temperatureMin || point.temperature_avg > thresholds.temperatureMax))
    || (hasHumidityThresholds && point.humidity_avg != null
      && (point.humidity_avg < thresholds.humidityMin || point.humidity_avg > thresholds.humidityMax))
  )).length;

  return {
    sessionId,
    startAt: session.start_at,
    endAt: session.end_at,
    thresholds,
    summary: {
      averageTemperature: average('temperature_avg'),
      averageHumidity: average('humidity_avg'),
      temperatureExceedanceCount,
      humidityExceedanceCount,
      exceededBucketCount: hasTemperatureThresholds || hasHumidityThresholds ? exceededBuckets : null,
      bucketCount: points.length,
    },
    points,
  };
}

async function getSessionDailyAverages(rawSessionId, user) {
  const sessionId = parseId(rawSessionId, 'sessionId');
  await assertSessionAccess(sessionId, user);
  const records = await model.findSessionDailyAverages(sessionId);
  return {
    sessionId,
    timezone: 'Asia/Ho_Chi_Minh',
    points: records.map((record) => ({
      date: record.date,
      temperature_avg: record.temperature_avg == null ? null : Number(record.temperature_avg),
      humidity_avg: record.humidity_avg == null ? null : Number(record.humidity_avg),
      bucket_count: Number(record.bucket_count),
    })),
  };
}

async function getFloorHistory(rawFloorId, user, query = {}) {
  const floorId = parseId(rawFloorId, 'floorId');
  const roleId = Number(user?.role_id);
  if (![1, 2, 3].includes(roleId)) {
    throw new AppError('You do not have permission to access this resource', 403);
  }
  const pagination = parsePagination(query);
  const filters = { ...parseDateRange(query), ...pagination };
  const userId = roleId === 3 ? parseId(user.user_id, 'userId') : null;
  return paginationFor(
    await model.findFloorHistory(floorId, filters, userId),
    pagination,
  );
}

module.exports = {
  getSessionHistory,
  getLatestSessionHistory,
  getSessionReport,
  getSessionDailyAverages,
  getFloorHistory,
};
