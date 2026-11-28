const test = require('node:test');
const assert = require('node:assert/strict');

function loadService() {
  const modelPath = require.resolve('../src/models/spawnInspection.model');
  const cloudinaryPath = require.resolve('../src/services/cloudinary.service');
  const realtimePath = require.resolve('../src/services/cultivationRealtime.service');
  const servicePath = require.resolve('../src/services/spawnInspection.service');
  const calls = [];
  const events = [];
  const model = {
    createInspection: async (...args) => {
      calls.push(args);
      return { inspection_id: 12, session_id: args[0], stage: 'RESTING' };
    },
    updateInspection: async (...args) => {
      calls.push(args);
      return { inspection_id: args[1], session_id: args[0] };
    },
    replaceAbnormalSpawn: async (...args) => {
      calls.push(args);
      return { inspection_id: args[0], session_id: 7 };
    },
    findInspectionForImage: async (...args) => {
      calls.push(args);
      return { inspection_id: args[0], session_id: 7 };
    },
    createImage: async (...args) => {
      calls.push(args);
      return { image_id: 4, inspection_id: args[0] };
    },
    changeStage: async (...args) => {
      calls.push(args);
      return { session_id: args[0], status: args[1], harvest_status: 'NOT_READY' };
    },
  };
  delete require.cache[modelPath];
  delete require.cache[cloudinaryPath];
  delete require.cache[realtimePath];
  delete require.cache[servicePath];
  require.cache[modelPath] = { exports: model };
  require.cache[cloudinaryPath] = {
    exports: { uploadImage: async () => 'https://images.example.test/spawn.jpg' },
  };
  require.cache[realtimePath] = {
    exports: { publishSessionUpdate: (...args) => events.push(args) },
  };
  return { service: require('../src/services/spawnInspection.service'), calls, events };
}

test('validates spawn inspection counts, condition, and replacement quantities', async () => {
  const { service, calls, events } = loadService();
  const inspection = await service.createFarmInspection('7', '3', {
    totalChecked: 6,
    normalQuantity: 4,
    warningQuantity: 1,
    abnormalQuantity: 1,
    replacementQuantity: 1,
    condition: 'abnormal',
    notes: 'One unit replaced',
  });

  assert.equal(inspection.inspection_id, 12);
  assert.deepEqual(calls, [[7, 3, {
    totalChecked: 6,
    normalQuantity: 4,
    warningQuantity: 1,
    abnormalQuantity: 1,
    replacementQuantity: 1,
    condition: 'ABNORMAL',
    notes: 'One unit replaced',
    nextCheckAt: undefined,
  }]]);
  assert.deepEqual(events, [[7, 'SPAWN_INSPECTION_RECORDED', { inspectionId: 12 }]]);

  await assert.rejects(
    () => service.createFarmInspection(7, 3, {
      totalChecked: 6,
      normalQuantity: 5,
      warningQuantity: 0,
      abnormalQuantity: 0,
      condition: 'NORMAL',
    }),
    { statusCode: 400, message: 'normalQuantity + warningQuantity + abnormalQuantity must equal totalChecked' },
  );
  await assert.rejects(
    () => service.createFarmInspection(7, 3, {
      totalChecked: 2,
      normalQuantity: 1,
      warningQuantity: 1,
      abnormalQuantity: 0,
      condition: 'NORMAL',
    }),
    { statusCode: 400, message: 'condition must match the most severe inspected quantity' },
  );
  await assert.rejects(
    () => service.createFarmInspection(7, 3, {
      totalChecked: 2,
      normalQuantity: 1,
      warningQuantity: 0,
      abnormalQuantity: 1,
      replacementQuantity: 2,
      condition: 'ABNORMAL',
    }),
    { statusCode: 400, message: 'replacementQuantity cannot exceed abnormalQuantity' },
  );
});

test('emits session stage changes after the database transition succeeds', async () => {
  const { service, events } = loadService();
  const session = await service.changeFarmStage(7, { stage: 'READY_FOR_CULTIVATION' });

  assert.equal(session.status, 'READY_FOR_CULTIVATION');
  assert.deepEqual(events, [[7, 'STAGE_CHANGED', {
    status: 'READY_FOR_CULTIVATION',
    harvestStatus: 'NOT_READY',
  }]]);
});

test('validates and updates a spawn inspection', async () => {
  const { service, calls, events } = loadService();
  const inspection = await service.updateFarmInspection('7', '12', {
    totalChecked: 6,
    normalQuantity: 4,
    warningQuantity: 1,
    abnormalQuantity: 1,
    replacementQuantity: 1,
    condition: 'abnormal',
    notes: 'Corrected count',
  });

  assert.equal(inspection.inspection_id, 12);
  assert.deepEqual(calls, [[7, 12, {
    totalChecked: 6,
    normalQuantity: 4,
    warningQuantity: 1,
    abnormalQuantity: 1,
    replacementQuantity: 1,
    condition: 'ABNORMAL',
    notes: 'Corrected count',
    nextCheckAt: undefined,
  }]]);
  assert.deepEqual(events, [[7, 'SPAWN_INSPECTION_UPDATED', { inspectionId: 12 }]]);
  await assert.rejects(
    () => service.updateFarmInspection(7, 12, {
      totalChecked: 2,
      normalQuantity: 1,
      warningQuantity: 1,
      abnormalQuantity: 0,
      replacementQuantity: 0,
      condition: 'NORMAL',
    }),
    { statusCode: 400 },
  );
});

test('emits after issuing replacement spawn', async () => {
  const { service, calls, events } = loadService();
  const result = await service.replaceFarmSpawn('12', { replacementQuantity: 1 });

  assert.equal(result.session_id, 7);
  assert.deepEqual(calls, [[12, 1]]);
  assert.deepEqual(events, [[7, 'SPAWN_REPLACEMENT_ISSUED', { inspectionId: 12 }]]);
});

test('emits after adding an image to a spawn inspection', async () => {
  const { service, calls, events } = loadService();
  const result = await service.addFarmInspectionImage('12', { buffer: Buffer.from('image') }, {});

  assert.equal(result.inspection_id, 12);
  assert.deepEqual(calls, [
    [12],
    [12, 'https://images.example.test/spawn.jpg', undefined],
  ]);
  assert.deepEqual(events, [[7, 'SPAWN_INSPECTION_IMAGE_ADDED', { inspectionId: 12 }]]);
});

test('only allows the next spawn stage in the workflow', async () => {
  const { service } = loadService();
  await assert.rejects(
    () => service.changeFarmStage(7, { stage: 'ACTIVE' }),
    { statusCode: 400 },
  );
});
