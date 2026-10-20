const test = require('node:test');
const assert = require('node:assert/strict');

function loadRentalService(modelOverrides = {}) {
  const modelPath = require.resolve('../src/models/rental.model');
  const servicePath = require.resolve('../src/services/rental.service');
  const calls = [];
  const model = {
    findAllForAdmin: async (filters) => {
      calls.push(['findAllForAdmin', filters]);
      return { rentals: [{ rental_id: 12 }], total: 24 };
    },
    findByIdForAdmin: async (rentalId) => {
      calls.push(['findByIdForAdmin', rentalId]);
      return rentalId === 12 ? { rental_id: 12 } : null;
    },
    createFromOrderForAdmin: async (orderId) => {
      calls.push(['createFromOrderForAdmin', orderId]);
      return { rentalId: 12, created: true };
    },
    startCultivationForAdmin: async (...args) => {
      calls.push(['startCultivationForAdmin', ...args]);
      return { session: { session_id: 77 }, rental: { rental_id: 12, status: 'ACTIVE' } };
    },
    updateForAdmin: async (...args) => {
      calls.push(['updateForAdmin', ...args]);
      return { rental_id: args[0] };
    },
    ...modelOverrides,
  };
  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[modelPath] = { exports: model };
  return { service: require('../src/services/rental.service'), calls };
}

test('lists rentals with validated filters and pagination', async () => {
  const { service, calls } = loadRentalService();

  const result = await service.getAllRentalsForAdmin({
    status: 'active',
    userId: '3',
    packageId: '4',
    trayId: '8',
    startDateFrom: '2026-01-01T00:00:00.000Z',
    startDateTo: '2026-01-31T00:00:00.000Z',
    page: '2',
    pageSize: '10',
  });

  assert.deepEqual(calls[0], ['findAllForAdmin', {
    status: 'ACTIVE',
    userId: 3,
    packageId: 4,
    trayId: 8,
    startDateFrom: '2026-01-01T00:00:00.000Z',
    startDateTo: '2026-01-31T00:00:00.000Z',
    limit: 10,
    offset: 10,
  }]);
  assert.deepEqual(result.pagination, { page: 2, pageSize: 10, total: 24, totalPages: 3 });
});

test('rejects invalid rental filters, dates, and pagination', async () => {
  const { service, calls } = loadRentalService();

  await assert.rejects(
    () => service.getAllRentalsForAdmin({ status: 'unknown' }),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.getAllRentalsForAdmin({ startDateFrom: '2026-02-01', startDateTo: '2026-01-01' }),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.getAllRentalsForAdmin({ pageSize: 101 }),
    { statusCode: 400 },
  );
  assert.equal(calls.length, 0);
});

test('updates rental status, tray, duration, and timestamps with validated data', async () => {
  const { service, calls } = loadRentalService();

  await service.updateRentalForAdmin('12', {
    status: 'preparing',
    trayId: 8,
    durationDays: 30,
    startDate: '2026-02-01T00:00:00Z',
    endDate: '2026-03-01T00:00:00Z',
  });

  assert.deepEqual(calls[0], ['updateForAdmin', 12, {
    status: 'PREPARING',
    trayId: 8,
    durationDays: 30,
    startDate: '2026-02-01T00:00:00.000Z',
    endDate: '2026-03-01T00:00:00.000Z',
  }]);
});

test('rejects malformed timestamps, nonpositive duration, and backwards rental dates', async () => {
  const { service, calls } = loadRentalService();

  await assert.rejects(
    () => service.updateRentalForAdmin('12', { startDate: '2026-02-30' }),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.updateRentalForAdmin('12', { durationDays: 0 }),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.updateRentalForAdmin('12', {
      startDate: '2026-03-02T00:00:00Z',
      endDate: '2026-03-01T00:00:00Z',
    }),
    { statusCode: 400 },
  );
  assert.equal(calls.length, 0);
});

test('returns not found for unknown rentals', async () => {
  const { service } = loadRentalService();
  await assert.rejects(
    () => service.getRentalByIdForAdmin('13'),
    { statusCode: 404, message: 'Rental not found' },
  );
});

test('creates a rental manually from a paid rental order', async () => {
  const { service, calls } = loadRentalService();

  const result = await service.createRentalFromOrderForAdmin('15');

  assert.deepEqual(calls, [
    ['createFromOrderForAdmin', 15],
    ['findByIdForAdmin', 12],
  ]);
  assert.deepEqual(result, { rental: { rental_id: 12 }, created: true });
});

test('starts cultivation using validated rental and tray IDs', async () => {
  const { service, calls } = loadRentalService();
  const result = await service.startCultivationForAdmin('12', { trayId: '8' });

  assert.deepEqual(calls, [['startCultivationForAdmin', 12, 8]]);
  assert.deepEqual(result, {
    session: { session_id: 77 },
    rental: { rental_id: 12, status: 'ACTIVE' },
  });
});

test('rejects start cultivation requests without a valid tray ID', async () => {
  const { service, calls } = loadRentalService();

  await assert.rejects(
    () => service.startCultivationForAdmin('12', {}),
    { statusCode: 400 },
  );
  assert.equal(calls.length, 0);
});
