const test = require('node:test');
const assert = require('node:assert/strict');
const { createCultivationRealtimeService } = require('../src/services/cultivationRealtime.service');

test('emits cultivation updates only to the session room with an allowlisted payload', () => {
  const emitted = [];
  const realtime = createCultivationRealtimeService({
    emit: (...args) => emitted.push(args),
    now: () => new Date('2026-10-25T10:00:00.000Z'),
  });

  realtime.publishSessionUpdate(12, 'GROWTH_UPDATED', {
    status: 'CULTIVATING',
    growthStage: 'PINNING',
    progressPercent: 42,
    harvestReady: false,
    expectedHarvestDate: '2026-11-30',
    notes: 'Private inspection notes',
    customerEmail: 'private@example.test',
  });

  assert.deepEqual(emitted, [[12, 'cultivation:session.updated', {
    sessionId: 12,
    changeType: 'GROWTH_UPDATED',
    occurredAt: '2026-10-25T10:00:00.000Z',
    status: 'CULTIVATING',
    growthStage: 'PINNING',
    progressPercent: 42,
    harvestReady: false,
    expectedHarvestDate: '2026-11-30',
  }]]);
});

test('logs delivery errors without throwing from a committed mutation', () => {
  const errors = [];
  const realtime = createCultivationRealtimeService({
    emit: () => { throw new Error('socket unavailable'); },
    logger: { error: (...args) => errors.push(args) },
  });

  assert.doesNotThrow(() => realtime.publishSessionUpdate(12, 'SESSION_CANCELLED'));
  assert.equal(errors.length, 1);
});

test('includes only valid inspection identifiers and sources in inspection events', () => {
  const emitted = [];
  const realtime = createCultivationRealtimeService({
    emit: (...args) => emitted.push(args),
    now: () => new Date('2026-10-25T10:00:00.000Z'),
  });

  realtime.publishSessionUpdate(12, 'TRAY_INSPECTION_RECORDED', {
    inspectionId: 31,
    inspectionSource: 'AUTO',
    notes: 'Private inspection notes',
    imageUrl: 'https://private.example.test/image.jpg',
  });
  realtime.publishSessionUpdate(12, 'SPAWN_INSPECTION_RECORDED', {
    inspectionId: -1,
    inspectionSource: 'UNKNOWN',
  });

  assert.deepEqual(emitted, [
    [12, 'cultivation:session.updated', {
      sessionId: 12,
      changeType: 'TRAY_INSPECTION_RECORDED',
      occurredAt: '2026-10-25T10:00:00.000Z',
      inspectionId: 31,
      inspectionSource: 'AUTO',
    }],
    [12, 'cultivation:session.updated', {
      sessionId: 12,
      changeType: 'SPAWN_INSPECTION_RECORDED',
      occurredAt: '2026-10-25T10:00:00.000Z',
    }],
  ]);
});
