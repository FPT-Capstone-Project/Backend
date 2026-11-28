const { emitToSession } = require('../socket');

const CHANGE_TYPES = new Set([
  'TRAYS_ASSIGNED',
  'GROWTH_UPDATED',
  'TRAY_INSPECTION_RECORDED',
  'TRAY_INSPECTION_UPDATED',
  'TRAY_INSPECTION_IMAGE_ADDED',
  'SPAWN_INSPECTION_RECORDED',
  'SPAWN_INSPECTION_UPDATED',
  'SPAWN_INSPECTION_IMAGE_ADDED',
  'SPAWN_REPLACEMENT_ISSUED',
  'HARVEST_READINESS_CHANGED',
  'STAGE_CHANGED',
  'SESSION_CANCELLED',
  'HARVEST_STARTED',
  'HARVEST_YIELD_RECORDED',
  'HARVEST_COMPLETED',
  'HARVEST_HANDOVER_COMPLETED',
]);

function createCultivationRealtimeService({
  emit = emitToSession,
  logger = console,
  now = () => new Date(),
} = {}) {
  function publishSessionUpdate(sessionId, changeType, details = {}) {
    const id = Number(sessionId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new TypeError('sessionId must be a positive integer');
    }
    if (!CHANGE_TYPES.has(changeType)) {
      throw new TypeError('Unsupported cultivation change type');
    }

    const payload = {
      sessionId: id,
      changeType,
      occurredAt: now().toISOString(),
    };
    for (const field of ['status', 'harvestStatus', 'growthStage']) {
      if (typeof details[field] === 'string') payload[field] = details[field];
    }
    if (typeof details.progressPercent === 'number' && Number.isFinite(details.progressPercent)) {
      payload.progressPercent = details.progressPercent;
    }
    if (typeof details.harvestReady === 'boolean') payload.harvestReady = details.harvestReady;
    if (typeof details.growthSynchronized === 'boolean') {
      payload.growthSynchronized = details.growthSynchronized;
    }
    if (Number.isSafeInteger(details.inspectionId) && details.inspectionId > 0) {
      payload.inspectionId = details.inspectionId;
    }
    if (['MANUAL', 'AUTO'].includes(details.inspectionSource)) {
      payload.inspectionSource = details.inspectionSource;
    }
    for (const field of ['assignedTrayCount', 'matchingTrays']) {
      if (Number.isSafeInteger(details[field]) && details[field] >= 0) {
        payload[field] = details[field];
      }
    }
    if (typeof details.expectedHarvestDate === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(details.expectedHarvestDate)) {
      payload.expectedHarvestDate = details.expectedHarvestDate;
    }

    try {
      emit(id, 'cultivation:session.updated', payload);
    } catch (error) {
      logger.error('Không thể phát sự kiện realtime cho phiên trồng:', error);
    }
  }

  return { publishSessionUpdate };
}

module.exports = { ...createCultivationRealtimeService(), createCultivationRealtimeService };
