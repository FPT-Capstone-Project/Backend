const cultivationTrayModel = require('../models/cultivationTray.model');
const cultivationRoomModel = require('../models/cultivationRoom.model');
const AppError = require('../utils/app-error');

const VALID_STATUSES = ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'INACTIVE'];

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new AppError(`${fieldName} must be a positive integer`, 400);
  return parsed;
}

function normalizeStatus(value = 'AVAILABLE') {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!VALID_STATUSES.includes(status)) {
    throw new AppError('status must be AVAILABLE, OCCUPIED, MAINTENANCE or INACTIVE', 400);
  }
  return status;
}

function normalizeRequiredText(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AppError(`${fieldName} is required`, 400);
  return text;
}

async function ensureRoomExists(roomId) {
  if (!await cultivationRoomModel.findById(roomId)) throw new AppError('Cultivation room not found', 404);
}

function handleDatabaseError(error, operation) {
  if (error.code === '23505') throw new AppError('trayCode already exists', 409);
  if (error.code === '23503' && operation === 'delete') {
    throw new AppError('Tray cannot be deleted while it is used by a cultivation session', 409);
  }
  if (error.code === '23503') throw new AppError('Cultivation room not found', 404);
  throw error;
}

async function getAllCultivationTrays(filters = {}) {
  let roomId;
  let status;
  if (filters.roomId !== undefined && String(filters.roomId).trim() !== '') roomId = parseId(filters.roomId, 'roomId');
  if (filters.status !== undefined && String(filters.status).trim() !== '') status = normalizeStatus(filters.status);
  return cultivationTrayModel.findAll({ roomId, status });
}

async function getCultivationTrayById(trayId) {
  const tray = await cultivationTrayModel.findById(parseId(trayId, 'trayId'));
  if (!tray) throw new AppError('Cultivation tray not found', 404);
  return tray;
}

async function createCultivationTray(payload = {}) {
  const roomId = parseId(payload.roomId ?? payload.room_id, 'roomId');
  const trayCode = normalizeRequiredText(payload.trayCode ?? payload.tray_code, 'trayCode');
  const trayNameValue = payload.trayName ?? payload.tray_name;
  const trayName = trayNameValue == null || trayNameValue === '' ? null : String(trayNameValue).trim();
  const status = normalizeStatus(payload.status ?? 'AVAILABLE');
  await ensureRoomExists(roomId);

  try {
    return await cultivationTrayModel.create({ roomId, trayCode, trayName, status });
  } catch (error) {
    handleDatabaseError(error, 'create');
  }
}

async function updateCultivationTray(trayId, payload = {}) {
  const id = parseId(trayId, 'trayId');
  if (!await cultivationTrayModel.findById(id)) throw new AppError('Cultivation tray not found', 404);
  if (!payload || Object.keys(payload).length === 0) throw new AppError('No update data provided', 400);

  const data = {};
  if (payload.roomId !== undefined || payload.room_id !== undefined) {
    const roomId = parseId(payload.roomId ?? payload.room_id, 'roomId');
    await ensureRoomExists(roomId);
    data.room_id = roomId;
  }
  if (payload.trayCode !== undefined || payload.tray_code !== undefined) {
    data.tray_code = normalizeRequiredText(payload.trayCode ?? payload.tray_code, 'trayCode');
  }
  if (payload.trayName !== undefined || payload.tray_name !== undefined) {
    const trayName = payload.trayName ?? payload.tray_name;
    data.tray_name = trayName == null || trayName === '' ? null : String(trayName).trim();
  }
  if (payload.status !== undefined) data.status = normalizeStatus(payload.status);
  if (Object.keys(data).length === 0) throw new AppError('No valid fields provided for update', 400);

  try {
    const tray = await cultivationTrayModel.updateById(id, data);
    if (!tray) throw new AppError('Cultivation tray not found', 404);
    return tray;
  } catch (error) {
    handleDatabaseError(error, 'update');
  }
}

async function deleteCultivationTray(trayId) {
  const id = parseId(trayId, 'trayId');
  try {
    const tray = await cultivationTrayModel.removeById(id);
    if (!tray) throw new AppError('Cultivation tray not found', 404);
    return tray;
  } catch (error) {
    handleDatabaseError(error, 'delete');
  }
}

module.exports = {
  getAllCultivationTrays,
  getCultivationTrayById,
  createCultivationTray,
  updateCultivationTray,
  deleteCultivationTray,
};