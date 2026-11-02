const harvestModel = require('../models/harvest.model');
const AppError = require('../utils/app-error');

const HARVEST_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parseDecimal(value, fieldName) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && value.trim() === '')) {
    throw new AppError(`${fieldName} must be a number`, 400);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new AppError(`${fieldName} must be a number`, 400);
  if (parsed < 0) throw new AppError(`${fieldName} must be at least 0`, 400);
  return parsed;
}

function parseText(value, fieldName, maxLength) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new AppError(`${fieldName} must be a string`, 400);
  const text = value.trim();
  if (text.length > maxLength) {
    throw new AppError(`${fieldName} must be at most ${maxLength} characters`, 400);
  }
  return text || undefined;
}

function parseDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(`${fieldName} must be a valid YYYY-MM-DD date`, 400);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new AppError(`${fieldName} must be a valid YYYY-MM-DD date`, 400);
  }
  return value;
}

function parseOptionalStatus(value) {
  if (value === undefined || String(value).trim() === '') return undefined;
  const status = String(value).trim().toUpperCase();
  if (!HARVEST_STATUSES.includes(status)) {
    throw new AppError(`status must be one of: ${HARVEST_STATUSES.join(', ')}`, 400);
  }
  return status;
}

async function createHarvest(payload = {}) {
  return harvestModel.create(parseId(payload.sessionId ?? payload.session_id, 'sessionId'));
}

async function startHarvest(harvestId, harvestedBy) {
  return harvestModel.start(
    parseId(harvestId, 'harvestId'),
    parseId(harvestedBy, 'harvestedBy'),
  );
}

async function recordYield(harvestId, payload = {}, harvestedBy) {
  const totalWeightKg = parseDecimal(
    payload.totalWeightKg ?? payload.total_weight_kg,
    'totalWeightKg',
  );
  const usableWeightKg = parseDecimal(
    payload.usableWeightKg ?? payload.usable_weight_kg,
    'usableWeightKg',
  );
  const rejectedWeightKg = parseDecimal(
    payload.rejectedWeightKg ?? payload.rejected_weight_kg,
    'rejectedWeightKg',
  );
  if (Math.abs((usableWeightKg + rejectedWeightKg) - totalWeightKg) > 1e-9) {
    throw new AppError('usableWeightKg and rejectedWeightKg must equal totalWeightKg', 400);
  }
  const qualityGrade = parseText(
    payload.qualityGrade ?? payload.quality_grade,
    'qualityGrade',
    20,
  );
  return harvestModel.recordYield(
    parseId(harvestId, 'harvestId'),
    {
      totalWeightKg,
      usableWeightKg,
      rejectedWeightKg,
      qualityGrade: qualityGrade?.toUpperCase(),
      notes: parseText(payload.notes, 'notes', 2000),
    },
    parseId(harvestedBy, 'harvestedBy'),
  );
}

async function completeHarvest(harvestId, harvestedBy) {
  return harvestModel.complete(
    parseId(harvestId, 'harvestId'),
    parseId(harvestedBy, 'harvestedBy'),
  );
}

async function getHarvest(harvestId) {
  const harvest = await harvestModel.findById(parseId(harvestId, 'harvestId'));
  if (!harvest) throw new AppError('Harvest not found', 404);
  return harvest;
}

async function listHarvests(query = {}) {
  const fromDate = parseDate(query.fromDate ?? query.from_date, 'fromDate');
  const toDate = parseDate(query.toDate ?? query.to_date, 'toDate');
  if (fromDate && toDate && fromDate > toDate) {
    throw new AppError('fromDate must be on or before toDate', 400);
  }
  return harvestModel.findAllForAdmin({
    status: parseOptionalStatus(query.status),
    mushroomTypeId: query.mushroomTypeId === undefined || String(query.mushroomTypeId).trim() === ''
      ? undefined
      : parseId(query.mushroomTypeId, 'mushroomTypeId'),
    fromDate,
    toDate,
    orderId: query.orderId === undefined || String(query.orderId).trim() === ''
      ? undefined
      : parseId(query.orderId, 'orderId'),
  });
}

async function getOrderHarvestHistory(orderId) {
  const history = await harvestModel.findOrderHistory(parseId(orderId, 'orderId'));
  if (!history) throw new AppError('Order not found', 404);
  return history;
}

module.exports = {
  createHarvest,
  startHarvest,
  recordYield,
  completeHarvest,
  getHarvest,
  listHarvests,
  getOrderHarvestHistory,
};
