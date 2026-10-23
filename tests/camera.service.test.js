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
