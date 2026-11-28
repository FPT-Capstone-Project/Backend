const cultivationSessionModel = require('../models/cultivationSession.model');
const cloudinaryService = require('./cloudinary.service');
const cultivationRealtime = require('./cultivationRealtime.service');
const AppError = require('../utils/app-error');

const SESSION_STATUSES = [
  'PENDING',
  'SPAWN_RESTING',
  'MYCELIAL_DEVELOPMENT',
  'READY_FOR_CULTIVATION',
  'CULTIVATING',
  'HARVEST_READY',
  'HARVESTING',
  'COMPLETED',
  'CANCELLED',
];
const GROWTH_STAGES = [
  'FRUITING_INITIATION',
  'PINNING',
  'YOUNG_FRUITING',
  'MATURATION',
];
const INCIDENT_TYPES = [
  'NO_PINNING',
  'SLOW_GROWTH',
  'DRY_SHRIVELED',
  'MUSHY',
  'DEFORMED_GROWTH',
  'CONTAMINATION',
  'DISEASE',
  'DAMAGE',
  'SENSOR_DATA_LOSS',
  'DEVICE_FAILURE',
  'DELAYED_MATURATION',
  'QUALITY_FAILURE',
  'OTHER',
];
const INCIDENT_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];
const NOTIFICATION_TYPES = ['OPERATOR_MESSAGE', 'MUSHROOM_DISEASE', 'DEVICE_ISSUE'];
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function hasTimezone(value) {
  return typeof value === 'string'
    && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parseTrayIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AppError('trayIds must be a non-empty array', 400);
  }
  const trayIds = value.map((trayId, index) => parseId(trayId, `trayIds[${index}]`));
  if (new Set(trayIds).size !== trayIds.length) {
    throw new AppError('trayIds must not contain duplicates', 400);
  }
  return trayIds;
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
  if (filters.startDateFrom && !hasTimezone(filters.startDateFrom)) {
    throw new AppError('startDateFrom must be an ISO timestamp with timezone', 400);
  }
  if (filters.startDateTo && !hasTimezone(filters.startDateTo)) {
    throw new AppError('startDateTo must be an ISO timestamp with timezone', 400);
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

async function getAvailableTraysForAdmin(query = {}) {
  const rawFloorId = query.floorId ?? query.floor_id;
  const floorId = rawFloorId === undefined || rawFloorId === null || String(rawFloorId).trim() === ''
    ? undefined
    : parseId(rawFloorId, 'floorId');
  return cultivationSessionModel.findAvailableTraysForAdmin(floorId);
}

async function getProgressForAdmin(sessionId) {
  const session = await getByIdForAdmin(sessionId);
  const progressHistory = await cultivationSessionModel.findProgressForAdmin(session.session_id);
  const latestProgress = progressHistory.at(-1) || null;
  return {
    session_id: session.session_id,
    status: session.status,
    harvest_status: session.harvest_status,
    expected_harvest_date: session.harvest_date,
    growth_status: session.growth_status ?? null,
    condition: latestProgress?.condition ?? null,
    harvest_ready: session.harvest_ready ?? false,
    current_stage: latestProgress?.current_stage ?? null,
    progress_percent: latestProgress?.progress_percent ?? null,
    latest_progress: latestProgress,
    progress_history: progressHistory,
  };
}

function parseGrowthStage(value, fieldName) {
  const stage = parseText(value, fieldName, { required: true, maxLength: 100 }).toUpperCase();
  if (!GROWTH_STAGES.includes(stage)) {
    throw new AppError(`${fieldName} must be one of: ${GROWTH_STAGES.join(', ')}`, 400);
  }
  return stage;
}

function parseDailyInspectionPayload(payload = {}, includeGrowthStatus = false) {
  const growthStatus = includeGrowthStatus ? payload.growth_status ?? payload.growthStatus : undefined;
  return {
    ...(growthStatus != null && String(growthStatus).trim() !== ''
      ? { growthStatus: parseGrowthStage(growthStatus, 'growth_status') } : {}),
    trayCondition: parseText(payload.trayCondition ?? payload.tray_condition, 'trayCondition', { maxLength: 500 }),
    mushroomCondition: parseText(
      payload.mushroomCondition ?? payload.mushroom_condition,
      'mushroomCondition',
      { maxLength: 500 },
    ),
    notes: parseText(payload.notes, 'notes'),
  };
}

async function getDailyInspectionHistory(sessionId, user, query = {}) {
  const pagination = parsePagination(query);
  const sessionIdNumber = await getAccessibleSessionId(sessionId, user);
  const result = await cultivationSessionModel.findDailyInspectionHistoryForAdmin(
    sessionIdNumber,
    pagination,
  );
  if (!result) throw new AppError('Cultivation session not found', 404);
  const { total, ...history } = result;
  return {
    ...history,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}

async function getTrayDailyInspectionHistory(sessionId, sessionTrayId, user, query = {}) {
  const pagination = parsePagination(query);
  const sessionIdNumber = await getAccessibleSessionId(sessionId, user);
  const result = await cultivationSessionModel.findDailyInspectionHistoryForTray(
    sessionIdNumber,
    parseId(sessionTrayId, 'sessionTrayId'),
    pagination,
  );
  if (!result) throw new AppError('Session tray not found for this session', 404);
  const { total, ...history } = result;
  return {
    ...history,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      totalPages: Math.ceil(total / pagination.pageSize),
    },
  };
}

async function getAccessibleSessionId(sessionId, user) {
  const actorId = parseId(user?.user_id, 'userId');
  const roleId = Number(user?.role_id);
  if (![1, 2, 3].includes(roleId)) {
    throw new AppError('You do not have permission to access this resource', 403);
  }
  const sessionIdNumber = parseId(sessionId, 'sessionId');
  const sessionDetails = await getByIdForAdmin(sessionIdNumber);
  if (roleId === 3 && Number(sessionDetails.user_id) !== actorId) {
    throw new AppError('Cultivation session not found', 404);
  }
  return sessionIdNumber;
}

async function assignTraysForAdmin(sessionId, payload = {}) {
  const id = parseId(sessionId, 'sessionId');
  const result = await cultivationSessionModel.assignTraysForAdmin(
    id,
    {
      floorId: parseId(payload.floorId ?? payload.floor_id, 'floorId'),
      trayIds: parseTrayIds(payload.trayIds ?? payload.tray_ids),
    },
  );
  cultivationRealtime.publishSessionUpdate(id, 'TRAYS_ASSIGNED', {
    status: result.status,
    harvestStatus: result.harvest_status,
    assignedTrayCount: result.assigned_trays_count,
    expectedHarvestDate: result.harvest_date,
  });
  return result;
}

async function updateGrowthForAdmin(sessionId, payload = {}) {
  const progressPercent = parseDecimal(payload.progressPercent ?? payload.progress_percent,
    'progressPercent', { min: 0, max: 100 });
  const currentStage = parseGrowthStage(payload.growthStatus ?? payload.growth_status, 'growthStatus');
  const expectedHarvestDate = payload.expectedHarvestDate ?? payload.expected_harvest_date;
  if (expectedHarvestDate !== undefined) {
    if (typeof expectedHarvestDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expectedHarvestDate)
      || !Number.isFinite(Date.parse(expectedHarvestDate))
      || new Date(expectedHarvestDate).toISOString().slice(0, 10) !== expectedHarvestDate) {
      throw new AppError('expectedHarvestDate must be a valid YYYY-MM-DD date', 400);
    }
  }
  const id = parseId(sessionId, 'sessionId');
  const result = await cultivationSessionModel.updateGrowthForAdmin(id, {
    currentStage,
    progressPercent,
    expectedHarvestDate,
    condition: parseText(payload.condition, 'condition', { required: true, maxLength: 500 }),
    notes: parseText(payload.notes, 'notes'),
  });
  cultivationRealtime.publishSessionUpdate(id, 'GROWTH_UPDATED', {
    status: result.status,
    harvestStatus: result.harvest_status,
    growthStage: result.growth_status,
    progressPercent: Number(result.progress_percent),
    harvestReady: result.harvest_ready,
    expectedHarvestDate: result.expected_harvest_date,
  });
  return result;
}

async function updateHarvestReadinessForAdmin(sessionId, payload = {}, confirmedBy) {
  const harvestReady = payload.harvestReady ?? payload.harvest_ready;
  if (typeof harvestReady !== 'boolean') throw new AppError('harvestReady must be a boolean', 400);
  const id = parseId(sessionId, 'sessionId');
  const result = await cultivationSessionModel.updateHarvestReadinessForAdmin(id, {
    harvestReady,
    confirmedBy: parseId(confirmedBy, 'confirmedBy'),
    notes: parseText(payload.notes, 'notes'),
  });
  cultivationRealtime.publishSessionUpdate(id, 'HARVEST_READINESS_CHANGED', {
    status: result.status,
    harvestStatus: result.harvest_status,
    harvestReady: result.harvest_ready,
  });
  return result;
}

async function updateTrayGrowthFromQrForAdmin(payload, inspectedBy) {
  const allowedFields = ['qr_token', 'growth_status', 'trayCondition', 'mushroomCondition', 'notes'];
  const unexpectedField = Object.keys(payload).find((field) => !allowedFields.includes(field));
  if (unexpectedField !== undefined) {
    throw new AppError(`Unexpected field: ${unexpectedField}`, 400);
  }

  const qrToken = parseText(payload.qr_token, 'qr_token', { required: true, maxLength: 256 });
  const growthStatus = parseGrowthStage(payload.growth_status, 'growth_status');
  const result = await cultivationSessionModel.updateTrayGrowthFromQrForAdmin(
    qrToken,
    { ...parseDailyInspectionPayload(payload), growthStatus },
    inspectedBy,
  );
  const data = result.data;
  cultivationRealtime.publishSessionUpdate(data.session_id, 'TRAY_INSPECTION_RECORDED', {
    inspectionSource: 'MANUAL',
    status: data.status,
    harvestStatus: data.harvest_status,
    growthStage: data.growth_status,
    harvestReady: data.harvest_ready,
    growthSynchronized: data.synchronization?.is_synchronized,
    matchingTrays: data.synchronization?.matching_trays,
  });
  return result;
}

async function getTrayGrowthStatusForAdmin(sessionId) {
  const id = parseId(sessionId, 'sessionId');
  if (id > 2147483647) throw new AppError('sessionId exceeds the supported range', 400);
  const session = await cultivationSessionModel.findTrayGrowthStatusForAdmin(id);
  if (!session) throw new AppError('Cultivation session not found', 404);
  return session;
}

async function createInspectionForAdmin(sessionTrayId, payload = {}, inspectedBy) {
  const result = await cultivationSessionModel.createInspectionForAdmin(
    parseId(sessionTrayId, 'sessionTrayId'),
    parseDailyInspectionPayload(payload, true),
    parseId(inspectedBy, 'inspectedBy'),
  );
  cultivationRealtime.publishSessionUpdate(result.session_id, 'TRAY_INSPECTION_RECORDED', {
    inspectionId: result.inspection.inspection_id,
    inspectionSource: 'MANUAL',
  });
  const response = { ...result };
  delete response.session_id;
  return response;
}

async function updateInspectionForAdmin(sessionTrayId, inspectionId, payload = {}) {
  const result = await cultivationSessionModel.updateInspectionForAdmin(
    parseId(sessionTrayId, 'sessionTrayId'),
    parseId(inspectionId, 'inspectionId'),
    parseDailyInspectionPayload(payload),
  );
  cultivationRealtime.publishSessionUpdate(result.session_id, 'TRAY_INSPECTION_UPDATED', {
    inspectionId: result.inspection.inspection_id,
    inspectionSource: 'MANUAL',
  });
  const response = { ...result };
  delete response.session_id;
  return response;
}

async function createInspectionWithImagesForAdmin(sessionTrayId, payload = {}, inspectedBy, files = []) {
  const rawQrToken = payload.qr_token !== undefined ? payload.qr_token : payload.qrToken;
  const qrToken = typeof rawQrToken === 'string' ? rawQrToken.trim() : rawQrToken;
  const qrTokenSupplied = qrToken !== undefined
    && qrToken !== null
    && !(typeof qrToken === 'string' && qrToken === '');
  const rawBodySessionTrayId = payload.session_tray_id !== undefined
    ? payload.session_tray_id
    : payload.sessionTrayId;
  const bodySessionTrayIdSupplied = rawBodySessionTrayId !== undefined
    && rawBodySessionTrayId !== null
    && !(typeof rawBodySessionTrayId === 'string' && rawBodySessionTrayId.trim() === '');
  const bodySessionTrayId = bodySessionTrayIdSupplied ? rawBodySessionTrayId : undefined;
  const pathSessionTrayIdSupplied = sessionTrayId !== undefined
    && sessionTrayId !== null
    && String(sessionTrayId).trim() !== '';

  if (qrTokenSupplied && (bodySessionTrayId !== undefined || pathSessionTrayIdSupplied)) {
    throw new AppError('Send either qr_token or session_tray_id, not both', 400);
  }

  const inspectionData = parseDailyInspectionPayload(payload, true);
  const inspectedById = parseId(inspectedBy, 'inspectedBy');
  let inspectionResult;
  if (qrTokenSupplied) {
    if (typeof qrToken !== 'string' || qrToken.length > 256) {
      throw new AppError('QR không hợp lệ.', 400, 'INVALID_QR_TOKEN');
    }
    inspectionResult = await cultivationSessionModel.createInspectionFromQrForAdmin(
      qrToken,
      inspectionData,
      inspectedById,
    );
  } else {
    if (bodySessionTrayId === undefined && !pathSessionTrayIdSupplied) {
      throw new AppError('qr_token or session_tray_id is required', 400);
    }
    const bodyId = bodySessionTrayId === undefined
      ? undefined
      : parseId(bodySessionTrayId, 'session_tray_id');
    const pathId = pathSessionTrayIdSupplied
      ? parseId(sessionTrayId, 'sessionTrayId')
      : undefined;
    if (bodyId !== undefined && pathId !== undefined && bodyId !== pathId) {
      throw new AppError('session_tray_id does not match the sessionTrayId path parameter', 400);
    }
    inspectionResult = await cultivationSessionModel.createInspectionForAdmin(
      bodyId ?? pathId,
      inspectionData,
      inspectedById,
    );
  }

  cultivationRealtime.publishSessionUpdate(inspectionResult.session_id, 'TRAY_INSPECTION_RECORDED', {
    inspectionId: inspectionResult.inspection.inspection_id,
    inspectionSource: 'MANUAL',
  });
  const response = { ...inspectionResult };
  delete response.session_id;
  const inspectionId = inspectionResult.inspection.inspection_id;
  const images = await Promise.all(files.map(file => addInspectionImageForAdmin(
    inspectionId,
    file,
    { caption: payload.caption },
  )));
  return { ...response, images };
}

async function addInspectionImageForAdmin(inspectionId, file, payload = {}) {
  const id = parseId(inspectionId, 'inspectionId');
  if (!file) throw new AppError('Image file is required', 400);
  const inspection = await cultivationSessionModel.findInspectionForImage(id);
  if (!inspection) throw new AppError('Cultivation inspection not found', 404);
  const imageUrl = await cloudinaryService.uploadImage(file, 'cultivation-inspections');
  const image = await cultivationSessionModel.createInspectionImage(
    id,
    imageUrl,
    parseText(payload.caption, 'caption', { maxLength: 500 }),
  );
  cultivationRealtime.publishSessionUpdate(inspection.session_id, 'TRAY_INSPECTION_IMAGE_ADDED', {
    inspectionId: id,
    inspectionSource: inspection.source,
  });
  return image;
}

async function createIncidentForAdmin(sessionId, payload = {}, reportedBy) {
  const incidentType = parseText(payload.incidentType ?? payload.incident_type, 'incidentType', {
    required: true,
    maxLength: 100,
  }).toUpperCase();
  if (!INCIDENT_TYPES.includes(incidentType)) {
    throw new AppError(`incidentType must be one of: ${INCIDENT_TYPES.join(', ')}`, 400);
  }
  const severityValue = payload.severity === undefined
    ? undefined
    : parseText(payload.severity, 'severity', { required: true, maxLength: 20 }).toUpperCase();
  if (severityValue !== undefined && !INCIDENT_SEVERITIES.includes(severityValue)) {
    throw new AppError(`severity must be one of: ${INCIDENT_SEVERITIES.join(', ')}`, 400);
  }
  return cultivationSessionModel.createIncidentForAdmin(
    parseId(sessionId, 'sessionId'),
    {
      sessionTrayId: parseId(payload.sessionTrayId ?? payload.session_tray_id, 'sessionTrayId'),
      inspectionId: payload.inspectionId === undefined && payload.inspection_id === undefined
        ? undefined
        : parseId(payload.inspectionId ?? payload.inspection_id, 'inspectionId'),
      incidentType,
      title: payload.title === undefined
        ? incidentType.replaceAll('_', ' ')
        : parseText(payload.title, 'title', { required: true, maxLength: 255 }),
      description: parseText(payload.description, 'description', { maxLength: 5000 }),
      severity: severityValue,
      actionTaken: parseText(payload.actionTaken ?? payload.action_taken, 'actionTaken', { maxLength: 5000 }),
      nextAction: parseText(payload.nextAction ?? payload.next_action, 'nextAction', { maxLength: 5000 }),
    },
    parseId(reportedBy, 'reportedBy'),
  );
}

async function listIncidentsForAdmin(sessionId) {
  const id = parseId(sessionId, 'sessionId');
  const session = await cultivationSessionModel.findByIdForAdmin(id);
  if (!session) throw new AppError('Cultivation session not found', 404);
  return cultivationSessionModel.findIncidentsForAdmin(id);
}

async function cancelForAdmin(sessionId, payload = {}) {
  const reason = parseText(payload.reason, 'reason', { required: true, maxLength: 500 });
  if (reason.length < 3) throw new AppError('reason must be at least 3 characters', 400);
  const id = parseId(sessionId, 'sessionId');
  const result = await cultivationSessionModel.cancelForAdmin(id, reason);
  cultivationRealtime.publishSessionUpdate(id, 'SESSION_CANCELLED', {
    status: result.session?.status,
  });
  return result;
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
  if (![
    'PENDING', 'SPAWN_RESTING', 'MYCELIAL_DEVELOPMENT',
    'READY_FOR_CULTIVATION', 'CULTIVATING', 'HARVEST_READY', 'HARVESTING',
  ].includes(recipient.status)) {
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
  getAvailableTraysForAdmin,
  getProgressForAdmin,
  getDailyInspectionHistory,
  getTrayDailyInspectionHistory,
  assignTraysForAdmin,
  updateGrowthForAdmin,
  updateTrayGrowthFromQrForAdmin,
  getTrayGrowthStatusForAdmin,
  updateHarvestReadinessForAdmin,
  createInspectionForAdmin,
  updateInspectionForAdmin,
  createInspectionWithImagesForAdmin,
  addInspectionImageForAdmin,
  createIncidentForAdmin,
  listIncidentsForAdmin,
  cancelForAdmin,
  sendSessionNotification,
};
