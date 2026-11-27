const test = require('node:test');
const assert = require('node:assert/strict');

function loadCameraService() {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/camera.model');
  const servicePath = require.resolve('../src/services/camera.service');
  const statements = [];
  const pool = {
    query: async (query, values = []) => {
      statements.push({ query: query.trim().replace(/\s+/g, ' '), values });
      return { rows: [{ camera_id: 5, camera_code: 'device-123', status: 'ACTIVE' }] };
    },
  };
  delete require.cache[dbPath];
  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[dbPath] = { exports: pool };
  return { service: require('../src/services/camera.service'), statements };
}

function loadSnapshotService() {
  const modulePaths = [
    require.resolve('../src/models/camera.model'),
    require.resolve('../src/services/imou.service'),
    require.resolve('../src/services/cloudinary.service'),
    require.resolve('../src/services/camera.service'),
  ];
  const originalModules = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  const calls = [];

  require.cache[modulePaths[0]] = {
    exports: {
      findById: async (cameraId) => ({
        camera_id: cameraId,
        camera_code: 'device-123',
        camera_name: 'Camera A',
        status: 'ACTIVE',
      }),
    },
  };
  require.cache[modulePaths[1]] = {
    exports: {
      captureSnapshot: async (...args) => {
        calls.push(['captureSnapshot', ...args]);
        return { url: 'https://snapshot.example/image.jpg' };
      },
    },
  };
  require.cache[modulePaths[2]] = {
    exports: {
      uploadRemoteImage: async (...args) => {
        calls.push(['uploadRemoteImage', ...args]);
        return 'https://res.cloudinary.com/test/image/upload/snapshot.jpg';
      },
    },
  };
  delete require.cache[modulePaths[3]];

  return {
    calls,
    service: require('../src/services/camera.service'),
    restore: () => {
      modulePaths.forEach((modulePath) => {
        delete require.cache[modulePath];
        const originalModule = originalModules.get(modulePath);
        if (originalModule) require.cache[modulePath] = originalModule;
      });
    },
  };
}

test('creates cameras with Imou device ID and validates request fields', async () => {
  const { service, statements } = loadCameraService();
  await service.createCamera({
    roomId: '2',
    cameraCode: ' device-123 ',
    cameraName: '  Camera A ',
    status: 'active',
  });

  assert.deepEqual(statements[0].values, [2, 'device-123', 'Camera A', null, 'ACTIVE']);
  assert.match(statements[0].query, /INSERT INTO cameras/);

  await assert.rejects(
    () => service.createCamera({ roomId: 0, cameraCode: 'x', cameraName: 'x' }),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.createCamera({
      roomId: 2,
      cameraCode: 'x',
      cameraName: 'x',
      status: 'BROKEN',
    }),
    { statusCode: 400 },
  );
});

test('captures an active camera snapshot and uploads it to Cloudinary', async () => {
  const { service, calls, restore } = loadSnapshotService();
  try {
    const snapshot = await service.captureSnapshot(5, '2');
    assert.deepEqual(calls, [
      ['captureSnapshot', 'device-123', '2'],
      ['uploadRemoteImage', 'https://snapshot.example/image.jpg', 'camera-snapshots'],
    ]);
    assert.equal(snapshot.cameraId, 5);
    assert.equal(snapshot.cameraName, 'Camera A');
    assert.equal(snapshot.channelId, '2');
    assert.equal(
      snapshot.snapshotUrl,
      'https://res.cloudinary.com/test/image/upload/snapshot.jpg',
    );
    assert.equal(typeof snapshot.capturedAt, 'string');
  } finally {
    restore();
  }
});

test('updates supported camera fields and rejects empty updates', async () => {
  const { service, statements } = loadCameraService();
  await service.updateCamera('5', { cameraName: 'Camera B', streamUrl: null });

  assert.deepEqual(statements[0].values, ['Camera B', null, 5]);
  assert.match(statements[0].query, /UPDATE cameras/);
  await assert.rejects(
    () => service.updateCamera('5', {}),
    { statusCode: 400 },
  );
});

test('uses room and status filters when listing cameras', async () => {
  const { service, statements } = loadCameraService();
  await service.getAllCameras({ roomId: '2', status: 'OFFLINE' });

  assert.deepEqual(statements[0].values, [2, 'OFFLINE']);
  assert.match(statements[0].query, /c\.room_id = \$1 AND c\.status = \$2/);
});
