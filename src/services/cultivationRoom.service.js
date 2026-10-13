const cultivationRoomModel = require('../models/cultivationRoom.model');
const AppError = require('../utils/app-error');

const VALID_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'];

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new AppError(`${fieldName} must be a positive integer`, 400);
  return parsed;
}

function normalizeStatus(value = 'ACTIVE') {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!VALID_STATUSES.includes(status)) throw new AppError('status must be ACTIVE, INACTIVE or MAINTENANCE', 400);
  return status;
}

function normalizeRequiredText(value, fieldName) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new AppError(`${fieldName} is required`, 400);
  return text;
}

function parseCapacity(value) {
  const capacity = Number(value);
  if (!Number.isInteger(capacity) || capacity < 0) throw new AppError('capacity must be a non-negative integer', 400);
  return capacity;
}

function handleDatabaseError(error) {
  if (error.code === '23505') throw new AppError('roomCode already exists', 409);
  if (error.code === '23503') throw new AppError('Room cannot be deleted while it contains trays or devices', 409);
  throw error;
}

async function getAllCultivationRooms(filters = {}) {
  const status = filters.status === undefined || String(filters.status).trim() === ''
    ? undefined
    : normalizeStatus(filters.status);
  return cultivationRoomModel.findAll({ status });
}

async function getCultivationRoomById(roomId) {
  const room = await cultivationRoomModel.findById(parseId(roomId, 'roomId'));
  if (!room) throw new AppError('Cultivation room not found', 404);
  return room;
}

async function createCultivationRoom(payload = {}) {
  const data = {
    roomCode: normalizeRequiredText(payload.roomCode ?? payload.room_code, 'roomCode'),
    roomName: normalizeRequiredText(payload.roomName ?? payload.room_name, 'roomName'),
    description: payload.description == null || payload.description === '' ? null : String(payload.description).trim(),
    capacity: payload.capacity === undefined ? 0 : parseCapacity(payload.capacity),
    status: normalizeStatus(payload.status ?? 'ACTIVE'),
  };
  try {
    return await cultivationRoomModel.create(data);
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function updateCultivationRoom(roomId, payload = {}) {
  const id = parseId(roomId, 'roomId');
  if (!await cultivationRoomModel.findById(id)) throw new AppError('Cultivation room not found', 404);
  if (!payload || Object.keys(payload).length === 0) throw new AppError('No update data provided', 400);

  const data = {};
  if (payload.roomCode !== undefined || payload.room_code !== undefined) {
    data.room_code = normalizeRequiredText(payload.roomCode ?? payload.room_code, 'roomCode');
  }
  if (payload.roomName !== undefined || payload.room_name !== undefined) {
    data.room_name = normalizeRequiredText(payload.roomName ?? payload.room_name, 'roomName');
  }
  if (payload.description !== undefined) {
    data.description = payload.description == null || payload.description === '' ? null : String(payload.description).trim();
  }
  if (payload.capacity !== undefined) data.capacity = parseCapacity(payload.capacity);
  if (payload.status !== undefined) data.status = normalizeStatus(payload.status);
  if (Object.keys(data).length === 0) throw new AppError('No valid fields provided for update', 400);

  try {
    const room = await cultivationRoomModel.updateById(id, data);
    if (!room) throw new AppError('Cultivation room not found', 404);
    return room;
  } catch (error) {
    handleDatabaseError(error);
  }
}

async function deleteCultivationRoom(roomId) {
  const id = parseId(roomId, 'roomId');
  try {
    const room = await cultivationRoomModel.removeById(id);
    if (!room) throw new AppError('Cultivation room not found', 404);
    return room;
  } catch (error) {
    handleDatabaseError(error);
  }
}

module.exports = {
  getAllCultivationRooms,
  getCultivationRoomById,
  createCultivationRoom,
  updateCultivationRoom,
  deleteCultivationRoom,
};