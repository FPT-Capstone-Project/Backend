const test = require('node:test');
const assert = require('node:assert/strict');

function loadHarvestService() {
  const modelPath = require.resolve('../src/models/harvest.model');
  const servicePath = require.resolve('../src/services/harvest.service');
  const calls = [];
  const model = {
    create: async (...args) => {
      calls.push(['create', args]);
      return { harvest_id: 8, session_id: args[0], status: 'PLANNED' };
    },
    start: async (...args) => {
      calls.push(['start', args]);
      return { harvest_id: args[0], status: 'IN_PROGRESS' };
    },
    recordYield: async (...args) => {
      calls.push(['recordYield', args]);
      return { harvest_id: args[0], status: 'IN_PROGRESS' };
    },
    complete: async (...args) => {
      calls.push(['complete', args]);
      return { harvest_id: args[0], status: 'COMPLETED' };
    },
    findById: async (...args) => {
      calls.push(['findById', args]);
      return { harvest_id: args[0] };
    },
    findAllForAdmin: async (...args) => {
      calls.push(['findAllForAdmin', args]);
      return { harvests: [], total: 0 };
    },
    findOrderHistory: async (...args) => {
      calls.push(['findOrderHistory', args]);
      return { order_id: args[0], harvests: [] };
    },
  };

  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[modelPath] = { exports: model };
  return { service: require('../src/services/harvest.service'), calls };
}

function loadHarvestRequestService() {
  const modelPath = require.resolve('../src/models/harvestRequest.model');
  const servicePath = require.resolve('../src/services/harvestRequest.service');
  const calls = [];
  const model = {
    update: async (...args) => {
      calls.push(['update', args]);
      return { harvest_request_id: args[0], harvest_method: args[1].harvestMethod };
    },
    complete: async (...args) => {
      calls.push(['complete', args]);
      return { harvest_request_id: args[0], status: 'COMPLETED' };
    },
  };

  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[modelPath] = { exports: model };
  return { service: require('../src/services/harvestRequest.service'), calls };
}

test('creates and advances a harvest with normalized identifiers', async () => {
  const { service, calls } = loadHarvestService();

  const created = await service.createHarvest({ sessionId: '15' });
  await service.startHarvest('8', '2');
  await service.completeHarvest('8', '2');

  assert.deepEqual(created, { harvest_id: 8, session_id: 15, status: 'PLANNED' });
  assert.deepEqual(calls, [
    ['create', [15]],
    ['start', [8, 2]],
    ['complete', [8, 2]],
  ]);
  await assert.rejects(
    () => service.createHarvest({ sessionId: 0 }),
    { statusCode: 400, message: 'sessionId must be a positive integer' },
  );
});

test('validates and normalizes an actual harvest yield before delegating', async () => {
  const { service, calls } = loadHarvestService();

  await service.recordYield('8', {
    totalWeightKg: '5.2',
    usableWeightKg: '4.8',
    rejectedWeightKg: '0.4',
    qualityGrade: 'a',
    notes: 'Mushrooms developed evenly.',
  }, '2');

  assert.deepEqual(calls, [[
    'recordYield',
    [8, {
      totalWeightKg: 5.2,
      usableWeightKg: 4.8,
      rejectedWeightKg: 0.4,
      qualityGrade: 'A',
      notes: 'Mushrooms developed evenly.',
    }, 2],
  ]]);
  await assert.rejects(
    () => service.recordYield('8', {
      totalWeightKg: -1,
      usableWeightKg: 0,
      rejectedWeightKg: 0,
    }, '2'),
    { statusCode: 400, message: 'totalWeightKg must be at least 0' },
  );
  await assert.rejects(
    () => service.recordYield('8', {
      totalWeightKg: 5,
      usableWeightKg: 4.8,
      rejectedWeightKg: 0.1,
    }, '2'),
    { statusCode: 400, message: 'usableWeightKg and rejectedWeightKg must equal totalWeightKg' },
  );
});

test('validates harvest list filters and delegates history lookups', async () => {
  const { service, calls } = loadHarvestService();

  const list = await service.listHarvests({
    status: 'completed',
    mushroomTypeId: '3',
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
    orderId: '5',
  });
  const history = await service.getOrderHarvestHistory('5');
  const detail = await service.getHarvest('8');

  assert.deepEqual(list, { harvests: [], total: 0 });
  assert.deepEqual(history, { order_id: 5, harvests: [] });
  assert.deepEqual(detail, { harvest_id: 8 });
  assert.deepEqual(calls, [
    ['findAllForAdmin', [{
      status: 'COMPLETED',
      mushroomTypeId: 3,
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
      orderId: 5,
    }]],
    ['findOrderHistory', [5]],
    ['findById', [8]],
  ]);
  await assert.rejects(
    () => service.listHarvests({ status: 'INVALID' }),
    { statusCode: 400 },
  );
});

test('validates and normalizes pickup and delivery receiving requests', async () => {
  const { service, calls } = loadHarvestRequestService();
  const customer = { user_id: 3, role_id: 3 };

  await service.updateHarvestRequest('6', {
    harvestMethod: 'pickup',
    scheduledAt: '2026-10-26T09:00:00+07:00',
    customerNote: 'Please prepare a basket.',
  }, customer);
  await service.updateHarvestRequest('6', { harvestMethod: 'delivery' }, customer);
  await service.completeHarvestRequest('6', customer);

  assert.deepEqual(calls, [
    ['update', [6, {
      harvestMethod: 'PICKUP',
      scheduledAt: '2026-10-26T09:00:00+07:00',
      customerNote: 'Please prepare a basket.',
    }, customer]],
    ['update', [6, {
      harvestMethod: 'DELIVERY',
      scheduledAt: undefined,
      customerNote: undefined,
    }, customer]],
    ['complete', [6, customer]],
  ]);
  await assert.rejects(
    () => service.updateHarvestRequest('6', { harvestMethod: 'PICKUP' }, customer),
    { statusCode: 400, message: 'scheduledAt is required for PICKUP' },
  );
  await assert.rejects(
    () => service.updateHarvestRequest('6', { harvestMethod: 'COURIER' }, customer),
    { statusCode: 400, message: 'harvestMethod must be one of: PICKUP, DELIVERY' },
  );
});
