const test = require('node:test');
const assert = require('node:assert/strict');

function loadService() {
  const modelPath = require.resolve('../src/models/spawnInspection.model');
  const servicePath = require.resolve('../src/services/spawnInspection.service');
  const calls = [];
  const model = {
    createInspection: async (...args) => {
      calls.push(args);
      return { inspection_id: 12, stage: 'RESTING' };
    },
    updateInspection: async (...args) => {
      calls.push(args);
      return { inspection_id: args[1] };
    },
  };
  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[modelPath] = { exports: model };
  return { service: require('../src/services/spawnInspection.service'), calls };
}

test('validates spawn inspection counts, condition, and replacement quantities', async () => {
  const { service, calls } = loadService();
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

test('validates and updates a spawn inspection', async () => {
  const { service, calls } = loadService();
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

test('only allows the next spawn stage in the workflow', async () => {
  const { service } = loadService();
  await assert.rejects(
    () => service.changeFarmStage(7, { stage: 'ACTIVE' }),
    { statusCode: 400 },
  );
});
