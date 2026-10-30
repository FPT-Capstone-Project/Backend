const cultivationSessionModel = require('../models/cultivationSession.model');
const AppError = require('../utils/app-error');

const SESSION_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
const NOTIFICATION_TYPES = ['OPERATOR_MESSAGE', 'MUSHROOM_DISEASE', 'DEVICE_ISSUE'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parseStatus(value) {
  if (value === undefined || String(value).trim() === '') return undefined;
  const status = String(value).trim().toUpperCase();
  if (!SESSION_STATUSES.includes(status)) {
    throw new AppError(`status must be one of: ${SESSION_STATUSES.join(', ')}`, 400);
  }
  return status;
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

function parseDecimal(value, fieldName, { min, max } = {}) {
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && value.trim() === '')) {
    throw new AppError(`${fieldName} must be a number`, 400);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new AppError(`${fieldName} must be a number`, 400);
  if (min !== undefined && parsed < min) {
    throw new AppError(`${fieldName} must be at least ${min}`, 400);
  }
  if (max !== undefined && parsed > max) {
    throw new AppError(`${fieldName} must be at most ${max}`, 400);
  }
  return parsed;
}

function parseDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AppError(`${fieldName} must be a valid YYYY-MM-DD date`, 400);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) {
    throw new AppError(`${fieldName} must be a valid YYYY-MM-DD date`, 400);
  }
  return value;
}

function parsePagination(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? DEFAULT_PAGE_SIZE : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) {
    throw new AppError('page must be a positive integer', 400);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new AppError(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`, 400);
  }
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

async function getAllForAdmin(query = {}) {
  const pagination = parsePagination(query);
  const filters = {
    status: parseStatus(query.status),
    userId: query.userId === undefined || String(query.userId).trim() === ''
      ? undefined
      : parseId(query.userId, 'userId'),
    mushroomTypeId: query.mushroomTypeId === undefined || String(query.mushroomTypeId).trim() === ''
      ? undefined
      : parseId(query.mushroomTypeId, 'mushroomTypeId'),
    trayId: query.trayId === undefined || String(query.trayId).trim() === ''
      ? undefined
      : parseId(query.trayId, 'trayId'),
    startDateFrom: query.startDateFrom,
    startDateTo: query.startDateTo,
    limit: pagination.limit,
    offset: pagination.offset,
  };
  if (filters.startDateFrom && Number.isNaN(Date.parse(filters.startDateFrom))) {
    throw new AppError('startDateFrom must be a valid timestamp', 400);
  }
  if (filters.startDateTo && Number.isNaN(Date.parse(filters.startDateTo))) {
    throw new AppError('startDateTo must be a valid timestamp', 400);
  }
  if (filters.startDateFrom && filters.startDateTo
    && new Date(filters.startDateFrom) > new Date(filters.startDateTo)) {
    throw new AppError('startDateFrom must be on or before startDateTo', 400);
  }

  const result = await cultivationSessionModel.findAllForAdmin(filters);
  return {
    sessions: result.sessions,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pagination.pageSize),
    },
  };
}

async function getByIdForAdmin(sessionId) {
  const session = await cultivationSessionModel.findByIdForAdmin(
    parseId(sessionId, 'sessionId'),
  );
  if (!session) throw new AppError('Cultivation session not found', 404);
  return session;
}

async function createProgressForAdmin(sessionId, payload = {}) {
  const currentStage = parseText(payload.currentStage ?? payload.current_stage, 'currentStage', {
    required: true,
    maxLength: 100,
  }).toUpperCase();
  const progressPercent = parseDecimal(
    payload.progressPercent ?? payload.progress_percent,
    'progressPercent',
    { min: 0, max: 100 },
  );
  const description = parseText(payload.description, 'description');
  return cultivationSessionModel.createProgressForAdmin(
    parseId(sessionId, 'sessionId'),
    { currentStage, progressPercent, description },
  );
}

async function createInspectionForAdmin(sessionTrayId, payload = {}, inspectedBy) {
  const growthStage = parseText(payload.growthStage ?? payload.growth_stage, 'growthStage', {
    required: true,
    maxLength: 100,
  }).toUpperCase();
  const growthProgress = parseDecimal(
    payload.growthProgress ?? payload.growth_progress,
    'growthProgress',
    { min: 0, max: 100 },
  );
  return cultivationSessionModel.createInspectionForAdmin(
    parseId(sessionTrayId, 'sessionTrayId'),
    {
      growthStage,
      growthProgress,
      trayCondition: parseText(payload.trayCondition ?? payload.tray_condition, 'trayCondition', { maxLength: 500 }),
      mushroomCondition: parseText(
        payload.mushroomCondition ?? payload.mushroom_condition,
        'mushroomCondition',
        { maxLength: 500 },
      ),
      notes: parseText(payload.notes, 'notes'),
    },
    parseId(inspectedBy, 'inspectedBy'),
  );
}

async function createHarvestForAdmin(sessionTrayId, payload = {}, harvestedBy) {
  const totalWeightKg = parseDecimal(
    payload.totalWeightKg ?? payload.total_weight_kg,
    'totalWeightKg',
    { min: 0 },
  );
  if (totalWeightKg === 0) {
    throw new AppError('totalWeightKg must be greater than 0', 400);
  }
  const usableWeightKg = parseDecimal(
    payload.usableWeightKg ?? payload.usable_weight_kg,
    'usableWeightKg',
    { min: 0, max: totalWeightKg },
  );
  const rejectedWeightKg = payload.rejectedWeightKg === undefined
    && payload.rejected_weight_kg === undefined
    ? 0
    : parseDecimal(payload.rejectedWeightKg ?? payload.rejected_weight_kg, 'rejectedWeightKg', {
      min: 0,
      max: totalWeightKg,
    });
  if (usableWeightKg + rejectedWeightKg > totalWeightKg) {
    throw new AppError('usableWeightKg and rejectedWeightKg cannot exceed totalWeightKg', 400);
  }
  const harvestDate = parseDate(payload.harvestDate ?? payload.harvest_date, 'harvestDate');
  if (harvestDate && harvestDate > new Date().toISOString().slice(0, 10)) {
    throw new AppError('harvestDate cannot be in the future', 400);
  }
  return cultivationSessionModel.createHarvestForAdmin(
    parseId(sessionTrayId, 'sessionTrayId'),
    {
      totalWeightKg,
      usableWeightKg,
      rejectedWeightKg,
      harvestDate,
      qualityGrade: parseText(payload.qualityGrade ?? payload.quality_grade, 'qualityGrade', { maxLength: 20 }),
      notes: parseText(payload.notes, 'notes'),
    },
    parseId(harvestedBy, 'harvestedBy'),
  );
}

async function completeForAdmin(sessionId, payload = {}) {
  const note = parseText(payload.note, 'note');
  return cultivationSessionModel.completeForAdmin(parseId(sessionId, 'sessionId'), note);
}

async function cancelForAdmin(sessionId, payload = {}) {
  const reason = parseText(payload.reason, 'reason', { required: true, maxLength: 500 });
  if (reason.length < 3) throw new AppError('reason must be at least 3 characters', 400);
  return cultivationSessionModel.cancelForAdmin(parseId(sessionId, 'sessionId'), reason);
}

async function sendSessionNotification(sessionId, payload = {}, createdBy) {
  const id = parseId(sessionId, 'sessionId');
  const message = parseText(payload.message, 'message', { required: true });
  const title = payload.title === undefined
    ? 'Thông báo từ SmartMush Farm'
    : parseText(payload.title, 'title', { required: true, maxLength: 100 });
  const rawType = payload.type === undefined ? 'OPERATOR_MESSAGE' : String(payload.type).trim().toUpperCase();
  if (!NOTIFICATION_TYPES.includes(rawType)) {
    throw new AppError(`type must be one of: ${NOTIFICATION_TYPES.join(', ')}`, 400);
  }
  const operatorId = parseId(createdBy, 'createdBy');
  const recipient = await cultivationSessionModel.findSessionRecipient(id);
  if (!recipient) throw new AppError('Cultivation session not found', 404);
  if (!['PLANNED', 'ACTIVE'].includes(recipient.status)) {
    throw new AppError('Cannot send notifications for a completed or cancelled session', 409);
  }
  if (recipient.user_status !== 'ACTIVE') {
    throw new AppError('Recipient account is not active', 409);
  }
  return cultivationSessionModel.createSessionNotification({
    sessionId: id,
    userId: recipient.user_id,
    type: rawType,
    title,
    message,
    createdBy: operatorId,
  });
}

module.exports = {
  getAllForAdmin,
  getByIdForAdmin,
  createProgressForAdmin,
  createInspectionForAdmin,
  createHarvestForAdmin,
  completeForAdmin,
  cancelForAdmin,
  sendSessionNotification,
};
