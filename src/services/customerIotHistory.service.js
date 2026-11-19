const customerIotHistoryModel = require('../models/customerIotHistory.model');
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

async function assertSessionAccess(sessionId, user) {
  const roleId = Number(user?.role_id);
  if (![1, 2, 3].includes(roleId)) {
    throw new AppError('You do not have permission to access this resource', 403);
  }
  const session = await customerIotHistoryModel.findSessionOwner(
    sessionId,
    roleId === 3 ? parseId(user.user_id, 'userId') : null,
  );
  if (!session) throw new AppError('Cultivation session not found', 404);
}

function paginationResult(result, pagination) {
  return {
    ...result,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pagination.pageSize),
    },
  };
}

function parseFloorId(value) {
  if (value === undefined || value === null || value === '') return null;
  return parseId(value, 'floorId');
}

async function getDeviceHistory(rawSessionId, user, query = {}) {
  const sessionId = parseId(rawSessionId, 'sessionId');
  await assertSessionAccess(sessionId, user);
  const pagination = parsePagination(query);
  const floorId = parseFloorId(query.floorId);
  return paginationResult(
    await customerIotHistoryModel.findDeviceHistory(sessionId, {
      ...pagination,
      floorId,
    }),
    pagination,
  );
}

async function getSensorHistory(rawSessionId, user, query = {}) {
  const sessionId = parseId(rawSessionId, 'sessionId');
  await assertSessionAccess(sessionId, user);
  const pagination = parsePagination(query);
  const floorId = parseFloorId(query.floorId);
  return paginationResult(
    await customerIotHistoryModel.findSensorHistory(sessionId, {
      ...pagination,
      floorId,
    }),
    pagination,
  );
}

module.exports = { getDeviceHistory, getSensorHistory };
