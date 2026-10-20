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

async function ensureFloorBelongsToRoom(floorId, roomId) {
  if (floorId == null) return;
  const floor = await cultivationTrayModel.findFloorById(floorId);
  if (!floor) throw new AppError('Cultivation floor not found', 404);
  if (Number(floor.room_id) !== Number(roomId)) {
    throw new AppError('Cultivation floor must belong to the selected room', 400);
  }
}

function handleDatabaseError(error, operation) {
  if (error.code === '23505') throw new AppError('trayCode already exists', 409);
  if (error.code === '23503' && operation === 'delete') {
    throw new AppError('Tray cannot be deleted while it is used by a cultivation session', 409);
  }
  if (error.code === '23503') throw new AppError('Cultivation room or floor does not match the tray', 400);
  throw error;
}

async function getAllCultivationTrays(filters = {}) {
  let roomId;
  let floorId;
  let status;
  if (filters.roomId !== undefined && String(filters.roomId).trim() !== '') roomId = parseId(filters.roomId, 'roomId');
  if (filters.floorId !== undefined && String(filters.floorId).trim() !== '') floorId = parseId(filters.floorId, 'floorId');
  if (filters.status !== undefined && String(filters.status).trim() !== '') status = normalizeStatus(filters.status);
  const parsedFilters = { roomId, status };
  if (floorId !== undefined) parsedFilters.floorId = floorId;
  return cultivationTrayModel.findAll(parsedFilters);
}

async function getCultivationTraysByRoomId(roomId, filters = {}) {
  const id = parseId(roomId, 'roomId');
  await ensureRoomExists(id);
  return getAllCultivationTrays({ ...filters, roomId: id });
}

async function getCultivationTrayById(trayId) {
  const tray = await cultivationTrayModel.findById(parseId(trayId, 'trayId'));
  if (!tray) throw new AppError('Cultivation tray not found', 404);
  return tray;
}

async function createCultivationTray(payload = {}) {
  const roomId = parseId(payload.roomId ?? payload.room_id, 'roomId');
  const rawFloorId = payload.floorId !== undefined ? payload.floorId : payload.floor_id;
  const floorId = rawFloorId === undefined || rawFloorId === null || rawFloorId === ''
    ? null
    : parseId(rawFloorId, 'floorId');
  const trayCode = normalizeRequiredText(payload.trayCode ?? payload.tray_code, 'trayCode');
  const trayNameValue = payload.trayName ?? payload.tray_name;
  const trayName = trayNameValue == null || trayNameValue === '' ? null : String(trayNameValue).trim();
  const status = normalizeStatus(payload.status ?? 'AVAILABLE');
  await ensureRoomExists(roomId);
  await ensureFloorBelongsToRoom(floorId, roomId);

  try {
    return await cultivationTrayModel.create({ roomId, floorId, trayCode, trayName, status });
  } catch (error) {
    handleDatabaseError(error, 'create');
  }
}

async function updateCultivationTray(trayId, payload = {}) {
  const id = parseId(trayId, 'trayId');
  const existing = await cultivationTrayModel.findById(id);
  if (!existing) throw new AppError('Cultivation tray not found', 404);
  if (!payload || Object.keys(payload).length === 0) throw new AppError('No update data provided', 400);

  const data = {};
  let targetRoomId = existing.room_id;
  let targetFloorId = existing.floor_id;
  if (payload.roomId !== undefined || payload.room_id !== undefined) {
    const roomId = parseId(payload.roomId ?? payload.room_id, 'roomId');
    await ensureRoomExists(roomId);
    data.room_id = roomId;
    targetRoomId = roomId;
  }
  if (payload.floorId !== undefined || payload.floor_id !== undefined) {
    const rawFloorId = payload.floorId !== undefined ? payload.floorId : payload.floor_id;
    targetFloorId = rawFloorId === null || rawFloorId === ''
      ? null
      : parseId(rawFloorId, 'floorId');
    data.floor_id = targetFloorId;
  }
  await ensureFloorBelongsToRoom(targetFloorId, targetRoomId);
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
  getCultivationTraysByRoomId,
  getCultivationTrayById,
  createCultivationTray,
  updateCultivationTray,
  deleteCultivationTray,
};