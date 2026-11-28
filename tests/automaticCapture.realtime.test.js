const test = require('node:test');
const assert = require('node:assert/strict');

test('emits one private-session event for each automatic tray inspection saved', async () => {
  const modulePaths = [
    require.resolve('../src/models/automaticCapture.model'),
    require.resolve('../src/services/camera.service'),
    require.resolve('../src/services/cloudinary.service'),
    require.resolve('../src/services/cultivationRealtime.service'),
    require.resolve('../src/services/automaticCapture.service'),
  ];
  const previousModules = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  const events = [];
  const model = {
    findCameraById: async () => ({ camera_id: 1, floor_id: 2, status: 'ACTIVE' }),
    createCaptureLog: async () => ({ log_id: 9 }),
    recordCaptureImage: async () => ({ log_id: 9 }),
    findActiveSessionTrays: async () => [
      { session_tray_id: 21, tray_id: 1 },
      { session_tray_id: 22, tray_id: 2 },
    ],
    createCaptureInspection: async ({ sessionTrayId }) => ({
      inspection_id: sessionTrayId + 100,
      session_id: 7,
    }),
    finishCaptureLog: async () => ({ log_id: 9 }),
  };

  try {
    require.cache[modulePaths[0]] = { exports: model };
    require.cache[modulePaths[1]] = {
      exports: { captureSnapshot: async () => ({
        snapshotUrl: 'https://images.example.test/capture.jpg',
        capturedAt: '2026-11-28T05:30:00.000Z',
      }) },
    };
    require.cache[modulePaths[2]] = {
      exports: { getPublicIdFromUrl: () => 'capture-image' },
    };
    require.cache[modulePaths[3]] = {
      exports: { publishSessionUpdate: (...args) => events.push(args) },
    };

    const service = require('../src/services/automaticCapture.service');
    const result = await service.testCapture(1, 3);

    assert.equal(result.data.successTrays, 2);
    assert.deepEqual(events, [
      [7, 'TRAY_INSPECTION_RECORDED', {
        inspectionId: 121,
        inspectionSource: 'AUTO',
      }],
      [7, 'TRAY_INSPECTION_RECORDED', {
        inspectionId: 122,
        inspectionSource: 'AUTO',
      }],
    ]);
  } finally {
    for (const modulePath of modulePaths) {
      delete require.cache[modulePath];
      const previousModule = previousModules.get(modulePath);
      if (previousModule) require.cache[modulePath] = previousModule;
    }
  }
});
