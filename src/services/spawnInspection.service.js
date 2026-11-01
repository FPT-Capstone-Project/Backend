const spawnInspectionModel = require('../models/spawnInspection.model');
const cloudinaryService = require('./cloudinary.service');
const AppError = require('../utils/app-error');

const SESSION_STATUSES = [
  'PENDING',
  'SPAWN_RESTING',
  'MYCELIAL_DEVELOPMENT',
  'READY_FOR_CULTIVATION',
  'CULTIVATING',
  'HARVESTING',
  'COMPLETED',
  'CANCELLED',
];
const CONDITIONS = ['NORMAL', 'WARNING', 'ABNORMAL'];

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parseText(value, fieldName, { required = false, maxLength = 1000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new AppError(`${fieldName} is required`, 400);
    return undefined;
  }
  if (typeof value !== 'string') throw new AppError(`${fieldName} must be a string`, 400);
  const text = value.trim();
  if (required && !text) throw new AppError(`${fieldName} is required`, 400);
  if (text.length > maxLength) {
    throw new AppError(`${fieldName} must be at most ${maxLength} characters`, 400);
  }
  return text;
}

function parseCount(value, fieldName, { defaultValue } = {}) {
  if (value === undefined && defaultValue !== undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new AppError(`${fieldName} must be a non-negative integer`, 400);
  }
  return parsed;
}

function parseTimestamp(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new AppError(`${fieldName} must be a valid ISO timestamp`, 400);
  }
  if (new Date(value).getTime() <= Date.now()) {
    throw new AppError(`${fieldName} must be in the future`, 400);
  }
  return new Date(value).toISOString();
}

async function listFarmSessions(query = {}) {
  const rawStatus = query.status === undefined ? undefined : String(query.status).trim().toUpperCase();
  if (rawStatus && !SESSION_STATUSES.includes(rawStatus)) {
    throw new AppError(`status must be one of: ${SESSION_STATUSES.join(', ')}`, 400);
  }
  return spawnInspectionModel.findAllForFarm(rawStatus);
}

async function getFarmSession(sessionId) {
  const id = parseId(sessionId, 'sessionId');
  const session = await spawnInspectionModel.findByIdForFarm(id);
  if (!session) throw new AppError('Paid cultivation session not found', 404);
  return session;
}

async function createFarmInspection(sessionId, inspectedBy, payload = {}) {
  const totalChecked = parseCount(payload.totalChecked ?? payload.total_checked, 'totalChecked');
  const normalQuantity = parseCount(payload.normalQuantity ?? payload.normal_quantity, 'normalQuantity');
  const warningQuantity = parseCount(payload.warningQuantity ?? payload.warning_quantity, 'warningQuantity');
  const abnormalQuantity = parseCount(payload.abnormalQuantity ?? payload.abnormal_quantity, 'abnormalQuantity');
  const replacementQuantity = parseCount(
    payload.replacementQuantity ?? payload.replacement_quantity,
    'replacementQuantity',
    { defaultValue: 0 },
  );
  if (totalChecked < 1) throw new AppError('totalChecked must be greater than zero', 400);
  if (normalQuantity + warningQuantity + abnormalQuantity !== totalChecked) {
    throw new AppError('normalQuantity + warningQuantity + abnormalQuantity must equal totalChecked', 400);
  }
  if (replacementQuantity > abnormalQuantity) {
    throw new AppError('replacementQuantity cannot exceed abnormalQuantity', 400);
  }
  const condition = parseText(payload.condition, 'condition', { required: true, maxLength: 30 })
    .toUpperCase();
  if (!CONDITIONS.includes(condition)) {
    throw new AppError(`condition must be one of: ${CONDITIONS.join(', ')}`, 400);
  }
  if ((condition === 'NORMAL' && (warningQuantity > 0 || abnormalQuantity > 0))
    || (condition === 'WARNING' && (warningQuantity === 0 || abnormalQuantity > 0))
    || (condition === 'ABNORMAL' && abnormalQuantity === 0)) {
    throw new AppError('condition must match the most severe inspected quantity', 400);
  }
  return spawnInspectionModel.createInspection(
    parseId(sessionId, 'sessionId'),
    parseId(inspectedBy, 'inspectedBy'),
    {
      totalChecked,
      normalQuantity,
      warningQuantity,
      abnormalQuantity,
      replacementQuantity,
      condition,
      notes: parseText(payload.notes, 'notes', { maxLength: 5000 }),
      nextCheckAt: parseTimestamp(payload.nextCheckAt ?? payload.next_check_at, 'nextCheckAt'),
    },
  );
}

async function listFarmInspections(sessionId) {
  const session = await getFarmSession(sessionId);
  return spawnInspectionModel.findInspectionHistory(session.session_id);
}

async function addFarmInspectionImage(inspectionId, file, payload = {}) {
  const id = parseId(inspectionId, 'inspectionId');
  if (!file) throw new AppError('Image file is required', 400);
  const inspection = await spawnInspectionModel.findInspectionForImage(id);
  if (!inspection) throw new AppError('Spawn inspection not found', 404);
  const caption = parseText(payload.caption, 'caption', { maxLength: 500 });
  const imageUrl = await cloudinaryService.uploadImage(file, 'spawn-inspections');
  return spawnInspectionModel.createImage(id, imageUrl, caption);
}

async function replaceFarmSpawn(inspectionId, payload = {}) {
  const quantity = parseCount(
    payload.replacementQuantity ?? payload.replacement_quantity,
    'replacementQuantity',
  );
  if (quantity < 1) throw new AppError('replacementQuantity must be greater than zero', 400);
  return spawnInspectionModel.replaceAbnormalSpawn(
    parseId(inspectionId, 'inspectionId'),
    quantity,
  );
}

async function changeFarmStage(sessionId, payload = {}) {
  const nextStage = parseText(payload.stage ?? payload.status, 'stage', {
    required: true,
    maxLength: 50,
  }).toUpperCase();
  if (![
    'SPAWN_RESTING',
    'MYCELIAL_DEVELOPMENT',
    'READY_FOR_CULTIVATION',
    'CULTIVATING',
    'HARVESTING',
  ].includes(nextStage)) {
    throw new AppError(
      'stage must be SPAWN_RESTING, MYCELIAL_DEVELOPMENT, READY_FOR_CULTIVATION, CULTIVATING, or HARVESTING',
      400,
    );
  }
  return spawnInspectionModel.changeStage(parseId(sessionId, 'sessionId'), nextStage);
}

async function getCustomerCultivationStatus(orderId, userId, isAdmin = false) {
  const sessions = await spawnInspectionModel.findCustomerSessions(
    parseId(orderId, 'orderId'),
    parseId(userId, 'userId'),
    isAdmin,
  );
  return { orderId: Number(orderId), sessions };
}

async function getCustomerCultivationProgress(orderId, userId, isAdmin = false) {
  return spawnInspectionModel.findCustomerProgress(
    parseId(orderId, 'orderId'),
    parseId(userId, 'userId'),
    isAdmin,
  );
}

async function getCustomerSpawnInspections(orderId, userId, inspectionId, isAdmin = false) {
  const inspections = await spawnInspectionModel.findCustomerInspections(
    parseId(orderId, 'orderId'),
    parseId(userId, 'userId'),
    inspectionId === undefined ? undefined : parseId(inspectionId, 'inspectionId'),
    isAdmin,
  );
  if (inspectionId !== undefined && inspections.length === 0) {
    throw new AppError('Spawn inspection not found for this order', 404);
  }
  return inspections;
}

module.exports = {
  listFarmSessions,
  getFarmSession,
  createFarmInspection,
  listFarmInspections,
  addFarmInspectionImage,
  replaceFarmSpawn,
  changeFarmStage,
  getCustomerCultivationStatus,
  getCustomerCultivationProgress,
  getCustomerSpawnInspections,
};
