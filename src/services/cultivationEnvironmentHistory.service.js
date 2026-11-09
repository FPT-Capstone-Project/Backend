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
  getFloorHistory,
};
