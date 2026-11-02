const harvestRequestModel = require('../models/harvestRequest.model');
const AppError = require('../utils/app-error');

const HARVEST_METHODS = ['PICKUP', 'DELIVERY'];

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parseMethod(value) {
  const method = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!HARVEST_METHODS.includes(method)) {
    throw new AppError(`harvestMethod must be one of: ${HARVEST_METHODS.join(', ')}`, 400);
  }
  return method;
}

function parseScheduledAt(value, method) {
  if (value === undefined || value === null || value === '') {
    if (method === 'PICKUP') throw new AppError('scheduledAt is required for PICKUP', 400);
    return undefined;
  }
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new AppError('scheduledAt must be a valid date-time', 400);
  }
  return value;
}

function parseNote(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new AppError('customerNote must be a string', 400);
  const note = value.trim();
  if (note.length > 2000) throw new AppError('customerNote must be at most 2000 characters', 400);
  return note || undefined;
}

function normalize(payload = {}) {
  const harvestMethod = parseMethod(payload.harvestMethod ?? payload.harvest_method);
  return {
    harvestMethod,
    scheduledAt: parseScheduledAt(payload.scheduledAt ?? payload.scheduled_at, harvestMethod),
    customerNote: parseNote(payload.customerNote ?? payload.customer_note),
  };
}

async function createHarvestRequest(payload = {}, actor) {
  return harvestRequestModel.create(
    parseId(payload.sessionId ?? payload.session_id, 'sessionId'),
    normalize(payload),
    actor,
  );
}

async function updateHarvestRequest(harvestRequestId, payload = {}, actor) {
  return harvestRequestModel.update(
    parseId(harvestRequestId, 'harvestRequestId'),
    normalize(payload),
    actor,
  );
}

async function completeHarvestRequest(harvestRequestId, actor) {
  return harvestRequestModel.complete(
    parseId(harvestRequestId, 'harvestRequestId'),
    actor,
  );
}

module.exports = {
  createHarvestRequest,
  updateHarvestRequest,
  completeHarvestRequest,
};
