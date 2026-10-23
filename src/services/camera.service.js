const cameraModel = require('../models/camera.model');
const imouService = require('./imou.service');
const AppError = require('../utils/app-error');

const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'OFFLINE'];

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function normalizeRequiredText(value, fieldName, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AppError(`${fieldName} is required`, 400);
  if (text.length > maxLength) {
    throw new AppError(`${fieldName} must be at most ${maxLength} characters`, 400);
  }
  return text;
}

function normalizeStatus(value = 'ACTIVE') {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!VALID_STATUSES.includes(status)) {
    throw new AppError('status must be ACTIVE, INACTIVE or OFFLINE', 400);
  }
  return status;
}

function normalizeStreamUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new AppError('streamUrl must be a URL', 400);
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'rtsp:', 'rtmp:'].includes(url.protocol)) throw new Error();
    return url.toString();
  } catch {
    throw new AppError('streamUrl must be a valid HTTP, HTTPS, RTSP or RTMP URL', 400);
  }
}

function handleDatabaseError(error, operation) {
  if (error.code === '23505') throw new AppError('cameraCode already exists', 409);
  if (error.code === '23503') {
    throw new AppError(
      operation === 'delete'
        ? 'Camera cannot be deleted while it is referenced by another record'
        : 'Cultivation room not found',
      operation === 'delete' ? 409 : 404,
    );
  }
  throw error;
}

async function getAllCameras(filters = {}) {
  const parsedFilters = {};
  if (filters.roomId !== undefined && String(filters.roomId).trim() !== '') {
    parsedFilters.roomId = parseId(filters.roomId, 'roomId');
  }
  if (filters.status !== undefined && String(filters.status).trim() !== '') {
    parsedFilters.status = normalizeStatus(filters.status);
  }
  return cameraModel.findAll(parsedFilters);
}

async function getCameraById(cameraId) {
  const camera = await cameraModel.findById(parseId(cameraId, 'cameraId'));
  if (!camera) throw new AppError('Camera not found', 404);
  return camera;
}

async function createCamera(payload = {}) {
  const data = {
    roomId: parseId(payload.roomId ?? payload.room_id, 'roomId'),
    cameraCode: normalizeRequiredText(
      payload.cameraCode ?? payload.camera_code,
      'cameraCode',
      100,
    ),
    cameraName: normalizeRequiredText(
      payload.cameraName ?? payload.camera_name,
      'cameraName',
      150,
    ),
    streamUrl: normalizeStreamUrl(payload.streamUrl ?? payload.stream_url),
    status: normalizeStatus(payload.status ?? 'ACTIVE'),
  };
  try {
    return await cameraModel.create(data);
  } catch (error) {
    handleDatabaseError(error, 'create');
  }
}

async function updateCamera(cameraId, payload = {}) {
  const id = parseId(cameraId, 'cameraId');
  if (!payload || Object.keys(payload).length === 0) {
    throw new AppError('No update data provided', 400);
  }

  const data = {};
  if (payload.roomId !== undefined || payload.room_id !== undefined) {
    data.room_id = parseId(payload.roomId ?? payload.room_id, 'roomId');
  }
  if (payload.cameraCode !== undefined || payload.camera_code !== undefined) {
    data.camera_code = normalizeRequiredText(
      payload.cameraCode ?? payload.camera_code,
      'cameraCode',
      100,
    );
  }
  if (payload.cameraName !== undefined || payload.camera_name !== undefined) {
    data.camera_name = normalizeRequiredText(
      payload.cameraName ?? payload.camera_name,
      'cameraName',
      150,
    );
  }
  if (payload.streamUrl !== undefined || payload.stream_url !== undefined) {
    data.stream_url = normalizeStreamUrl(payload.streamUrl ?? payload.stream_url);
  }
  if (payload.status !== undefined) data.status = normalizeStatus(payload.status);
  if (Object.keys(data).length === 0) {
    throw new AppError('No valid fields provided for update', 400);
  }

  try {
    const camera = await cameraModel.updateById(id, data);
    if (!camera) throw new AppError('Camera not found', 404);
    return camera;
  } catch (error) {
    handleDatabaseError(error, 'update');
  }
}

async function deleteCamera(cameraId) {
  const id = parseId(cameraId, 'cameraId');
  try {
    const camera = await cameraModel.removeById(id);
    if (!camera) throw new AppError('Camera not found', 404);
    return camera;
  } catch (error) {
    handleDatabaseError(error, 'delete');
  }
}

async function getLiveStream(cameraId, channelId = '0') {
  const camera = await cameraModel.findById(cameraId);
  if (!camera) throw new AppError('Camera not found', 404);
  if (camera.status !== 'ACTIVE') throw new AppError('Camera is not active', 409);
  if (!camera.camera_code) throw new AppError('Camera has no Imou device ID configured', 409);

  const stream = await imouService.getLiveStream(camera.camera_code, channelId);
  return {
    cameraId: camera.camera_id,
    cameraName: camera.camera_name,
    channelId,
    stream,
  };
}

async function getLiveStreams({ start = 1, limit = 20 } = {}) {
  const [result, cameras] = await Promise.all([
    imouService.listLiveStreams(start, limit),
    cameraModel.findAll(),
  ]);
  const camerasByDeviceId = new Map(
    cameras.map((camera) => [camera.camera_code, camera]),
  );
  return {
    count: result.count,
    start,
    limit,
    lives: result.lives.map((live) => {
      const camera = camerasByDeviceId.get(live.deviceId);
      return {
        liveToken: live.liveToken,
        liveType: live.liveType,
        liveStatus: live.liveStatus,
        deviceId: live.deviceId || null,
        channelId: live.channelId === undefined ? null : String(live.channelId),
        camera: camera ? {
          cameraId: camera.camera_id,
          cameraName: camera.camera_name,
          roomId: camera.room_id,
          roomName: camera.room_name,
        } : null,
        streams: Array.isArray(live.streams) ? live.streams : [],
        job: Array.isArray(live.job) ? live.job : [],
      };
    }),
  };
}

async function stopLiveStream(cameraId, channelId = '0') {
  const camera = await cameraModel.findById(parseId(cameraId, 'cameraId'));
  if (!camera) throw new AppError('Camera not found', 404);
  if (!camera.camera_code) throw new AppError('Camera has no Imou device ID configured', 409);
  return imouService.stopLiveStream(camera.camera_code, channelId);
}

async function stopLiveSession(liveToken) {
  const normalizedToken = normalizeRequiredText(liveToken, 'liveToken', 200);
  return imouService.stopLiveSession(normalizedToken);
}

module.exports = {
  getAllCameras,
  getCameraById,
  createCamera,
  updateCamera,
  deleteCamera,
  getLiveStream,
  getLiveStreams,
  stopLiveStream,
  stopLiveSession,
};
