const model = require('../models/socketRoom.model');

const ROOM_TYPES = new Set(['room', 'session', 'issue', 'consultation']);
const STAFF_ROLE_IDS = new Set([1, 2]);

function isExpertRole(roleName) {
  return typeof roleName === 'string'
    && roleName.toLowerCase().replace(/[\s_-]/g, '').includes('expert');
}

function parseRoomRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const keys = Object.keys(payload);
  if (keys.length !== 2 || !keys.includes('type') || !keys.includes('id')) return null;
  if (typeof payload.type !== 'string' || !ROOM_TYPES.has(payload.type)) return null;

  const id = typeof payload.id === 'number' || typeof payload.id === 'string'
    ? Number(payload.id)
    : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { type: payload.type, id };
}

function createRoomAccessService(repository = model) {
  async function canAccess(user, type, id) {
    const userId = Number(user?.userId);
    const roleId = Number(user?.roleId);
    if (!ROOM_TYPES.has(type) || !Number.isSafeInteger(id) || id <= 0
      || !Number.isSafeInteger(userId) || userId <= 0) return false;

    if (STAFF_ROLE_IDS.has(roleId)) return repository.resourceExists(type, id);

    if (roleId === 3) {
      if (type === 'session') return repository.customerOwnsSession(id, userId);
      if (type === 'room') return repository.customerHasActiveTrayInRoom(id, userId);
      if (type === 'issue') return repository.customerOwnsIssue(id, userId);
      if (type === 'consultation') return repository.customerOwnsConsultation(id, userId);
      return false;
    }

    if (isExpertRole(user?.roleName)) {
      if (type === 'issue') return repository.expertIsAssignedToIssue(id, userId);
      if (type === 'consultation') return repository.expertIsAssignedToConsultation(id, userId);
    }
    return false;
  }

  return { canAccess };
}

module.exports = {
  createRoomAccessService,
  parseRoomRequest,
  isExpertRole,
};
