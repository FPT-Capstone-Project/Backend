const model = require('../models/automaticCapture.model');
const cameraService = require('./camera.service');
const cloudinaryService = require('./cloudinary.service');
const AppError = require('../utils/app-error');
const { parsePagination } = require('../utils/pagination');

const VALID_LOG_STATUSES = ['PROCESSING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED'];

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

function parseCaptureTimes(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1440) {
    throw new AppError('captureTimes must be a non-empty array of HH:mm times', 400);
  }
  const seen = new Set();
  for (const time of value) {
    if (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new AppError('Each capture time must use HH:mm format', 400);
    }
    if (seen.has(time)) {
      throw new AppError('captureTimes must not contain duplicate times', 400);
    }
    seen.add(time);
  }
  return value;
}

async function requireActiveCamera(cameraId) {
  const camera = await model.findCameraById(cameraId);
  if (!camera) throw new AppError('Camera not found', 404);
  if (camera.status !== 'ACTIVE') throw new AppError('Camera is not active', 409);
  return camera;
}

async function getConfigs() {
  return model.findConfigs();
}

async function getConfig(rawCameraId) {
  const cameraId = parseId(rawCameraId, 'cameraId');
  await requireActiveCamera(cameraId);
  return model.findConfigByCameraId(cameraId);
}

async function updateConfig(rawCameraId, payload = {}) {
  const cameraId = parseId(rawCameraId, 'cameraId');
  const rawCaptureTimes = payload.captureTimes ?? payload.capture_times;
  const rawIsEnabled = payload.isEnabled ?? payload.is_enabled;
  if (rawCaptureTimes === undefined) {
    throw new AppError('captureTimes is required', 400);
  }
  if (typeof rawIsEnabled !== 'boolean') {
    throw new AppError('isEnabled must be a boolean', 400);
  }
  const captureTimes = parseCaptureTimes(rawCaptureTimes);

  await requireActiveCamera(cameraId);
  const updated = await model.upsertConfig(cameraId, captureTimes, rawIsEnabled);
  if (!updated) {
    await requireActiveCamera(cameraId);
    throw new AppError('Unable to update camera capture configuration', 409);
  }
  return model.findConfigByCameraId(cameraId);
}

async function getLogs(query = {}) {
  const pagination = parsePagination(query);
  const filters = {};
  if (query.cameraId !== undefined && String(query.cameraId).trim() !== '') {
    filters.cameraId = parseId(query.cameraId, 'cameraId');
    const camera = await model.findCameraById(filters.cameraId);
    if (!camera) throw new AppError('Camera not found', 404);
  }
  if (query.status !== undefined && String(query.status).trim() !== '') {
    const status = String(query.status).trim().toUpperCase();
    if (!VALID_LOG_STATUSES.includes(status)) {
      throw new AppError(
        `status must be one of ${VALID_LOG_STATUSES.join(', ')}`,
        400,
      );
    }
    filters.status = status;
  }

  const result = await model.findLogs({ ...filters, ...pagination });
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

async function getLog(rawLogId) {
  const logId = parseId(rawLogId, 'logId');
  const log = await model.findLogById(logId);
  if (!log) throw new AppError('Automatic capture log not found', 404);
  return log;
}

async function getCameraTrays(rawCameraId) {
  const cameraId = parseId(rawCameraId, 'cameraId');
  const camera = await model.findCameraById(cameraId);
  if (!camera) throw new AppError('Camera not found', 404);
  const trays = camera.floor_id == null
    ? []
    : await model.findTraysByFloor(camera.floor_id, camera.room_id);
  return {
    cameraId,
    floorId: camera.floor_id,
    trays,
  };
}

function captureErrorMessage(error) {
  const message = typeof error?.message === 'string'
    ? error.message.replace(/[\r\n]/g, ' ').slice(0, 500)
    : 'Camera capture failed';
  return message || 'Camera capture failed';
}

function inspectionErrorMessage(sessionTrayId, error) {
  const code = typeof error?.code === 'string' ? ` (${error.code})` : '';
  return `Failed to create inspection for session tray ${sessionTrayId}${code}`;
}

async function failCapture(logId, error, details = {}) {
  await model.finishCaptureLog(logId, {
    status: 'FAILED',
    capturedAt: details.capturedAt,
    imageUrl: details.imageUrl,
    publicId: details.publicId,
    totalTrays: details.totalTrays ?? 0,
    successTrays: details.successTrays ?? 0,
    failedTrays: details.failedTrays ?? 0,
    errorMessage: captureErrorMessage(error),
  });
}

async function testCapture(rawCameraId, inspectedBy) {
  const cameraId = parseId(rawCameraId, 'cameraId');
  const userId = parseId(inspectedBy, 'userId');
  const camera = await requireActiveCamera(cameraId);
  const log = await model.createCaptureLog(cameraId, new Date());
  if (!log) throw new AppError('Unable to create automatic capture log', 500);

  let snapshot;
  try {
    snapshot = await cameraService.captureSnapshot(cameraId);
  } catch (error) {
    await failCapture(log.log_id, error);
    throw error;
  }

  const capturedAt = snapshot.capturedAt || new Date().toISOString();
  const imageUrl = snapshot.snapshotUrl;
  const publicId = cloudinaryService.getPublicIdFromUrl(imageUrl);
  try {
    const savedImage = await model.recordCaptureImage(
      log.log_id,
      imageUrl,
      publicId,
      capturedAt,
    );
    if (!savedImage) throw new AppError('Capture log not found after image upload', 500);
  } catch (error) {
    await failCapture(log.log_id, error, { capturedAt, imageUrl, publicId });
    throw error;
  }

  let activeTrays;
  try {
    activeTrays = camera.floor_id == null
      ? []
      : await model.findActiveSessionTrays(camera.floor_id);
  } catch (error) {
    await failCapture(log.log_id, error, { capturedAt, imageUrl, publicId });
    throw error;
  }

  const failures = [];
  const trayResults = [];
  for (const tray of activeTrays) {
    try {
      const inspection = await model.createCaptureInspection({
        sessionTrayId: tray.session_tray_id,
        floorId: camera.floor_id,
        inspectedBy: userId,
        logId: log.log_id,
        imageUrl,
        capturedAt,
      });
      if (!inspection) {
        throw new AppError('Session tray is no longer active on this camera floor', 409);
      }
      trayResults.push({
        trayId: tray.tray_id,
        sessionTrayId: tray.session_tray_id,
        inspectionId: inspection.inspection_id,
        status: 'SUCCESS',
      });
    } catch (error) {
      const message = inspectionErrorMessage(tray.session_tray_id, error);
      failures.push(message);
      trayResults.push({
        trayId: tray.tray_id,
        sessionTrayId: tray.session_tray_id,
        status: 'FAILED',
        error: message,
      });
    }
  }

  const successTrays = trayResults.filter((tray) => tray.status === 'SUCCESS').length;
  const failedTrays = failures.length;
  const status = failedTrays === 0
    ? 'SUCCESS'
    : successTrays === 0
      ? 'FAILED'
      : 'PARTIAL_SUCCESS';
  await model.finishCaptureLog(log.log_id, {
    status,
    capturedAt,
    imageUrl,
    publicId,
    totalTrays: activeTrays.length,
    successTrays,
    failedTrays,
    errorMessage: failures.length ? failures.join('; ').slice(0, 1000) : null,
  });

  return {
    success: status === 'SUCCESS',
    message: status === 'SUCCESS'
      ? 'Test camera capture successfully'
      : status === 'PARTIAL_SUCCESS'
        ? 'Camera image captured; some tray inspections could not be saved'
        : 'Camera image captured, but tray inspections could not be saved',
    data: {
      logId: log.log_id,
      cameraId,
      floorId: camera.floor_id,
      imageUrl,
      capturedAt,
      totalTrays: activeTrays.length,
      successTrays,
      failedTrays,
      status,
      trays: trayResults,
    },
  };
}

module.exports = {
  getConfigs,
  getConfig,
  updateConfig,
  getLogs,
  getLog,
  getCameraTrays,
  testCapture,
};
