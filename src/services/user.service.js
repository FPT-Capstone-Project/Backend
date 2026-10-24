const userModel = require('../models/user.model');
const authService = require('./auth.service');
const AppError = require('../utils/app-error');

const USER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];

function parseId(value, fieldName) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return id;
}

function normalizeStatus(value) {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!USER_STATUSES.includes(status)) {
    throw new AppError('status must be ACTIVE, INACTIVE, or BLOCKED', 400);
  }
  return status;
}

async function getUsers(query = {}) {
  const roleValue = query.roleId ?? query.role_id;
  const roleId = roleValue === undefined || String(roleValue).trim() === ''
    ? undefined
    : parseId(roleValue, 'roleId');

  return userModel.findAllWithRole({ roleId });
}

async function getUserDetail(userId) {
  const user = await userModel.findDetailById(parseId(userId, 'userId'));
  if (!user) throw new AppError('User not found', 404);
  return user;
}

async function createUser(payload = {}) {
  const roleId = payload.roleId ?? payload.role_id;
  if (roleId === undefined || String(roleId).trim() === '') {
    throw new AppError('roleId is required', 400);
  }

  const { user } = await authService.register({
    ...payload,
    roleId,
    fullName: payload.fullName ?? payload.full_name ?? payload.name,
  });
  return userModel.findDetailById(user.user_id);
}

async function updateUserStatus(userId, payload = {}) {
  const user = await userModel.updateStatusById(
    parseId(userId, 'userId'),
    normalizeStatus(payload.status),
  );
  if (!user) throw new AppError('User not found', 404);
  return user;
}

module.exports = {
  getUsers,
  getUserDetail,
  createUser,
  updateUserStatus,
};
