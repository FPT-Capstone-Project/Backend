const test = require('node:test');
const assert = require('node:assert/strict');

function loadService() {
  const modelPath = require.resolve('../src/models/cultivationSession.model');
  const servicePath = require.resolve('../src/services/cultivationSession.service');
  const calls = [];
  const model = {
    createInspectionForAdmin: async (...args) => {
      calls.push(args);
      return { inspection: { inspection_id: 1 }, progress: { progress_id: 1 } };
    },
    createHarvestForAdmin: async (...args) => {
      calls.push(args);
      return { harvest_id: 1 };
    },
  };
  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[modelPath] = { exports: model };
  return { service: require('../src/services/cultivationSession.service'), calls };
}

test('validates daily inspection input and passes the Farm Operator ID', async () => {
  const { service, calls } = loadService();
  const result = await service.createInspectionForAdmin('14', {
    growthStage: 'fruiting',
    growthProgress: '65',
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
  }, '3');

  assert.equal(result.inspection.inspection_id, 1);
  assert.deepEqual(calls, [[14, {
    growthStage: 'FRUITING',
    growthProgress: 65,
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
    notes: undefined,
  }, 3]]);
  await assert.rejects(
    () => service.createInspectionForAdmin('14', { growthStage: 'FRUITING', growthProgress: 101 }, '3'),
    { statusCode: 400, message: 'growthProgress must be at most 100' },
  );
});

test('validates harvest quantities against the new weight-based harvest schema', async () => {
  const { service, calls } = loadService();
  await service.createHarvestForAdmin('14', {
    totalWeightKg: 4.5,
    usableWeightKg: 4,
    rejectedWeightKg: 0.5,
    qualityGrade: 'A',
  }, '3');
  assert.equal(calls[0][0], 14);
  assert.deepEqual(calls[0][1], {
    totalWeightKg: 4.5,
    usableWeightKg: 4,
    rejectedWeightKg: 0.5,
    harvestDate: undefined,
    qualityGrade: 'A',
    notes: undefined,
  });
  await assert.rejects(
    () => service.createHarvestForAdmin('14', {
      totalWeightKg: 1,
      usableWeightKg: 1,
      rejectedWeightKg: 0.5,
    }, '3'),
    { statusCode: 400, message: 'usableWeightKg and rejectedWeightKg cannot exceed totalWeightKg' },
  );
});
