const test = require('node:test');
const assert = require('node:assert/strict');

const stages = ['PREPARATION', 'INCUBATION', 'PINNING', 'FRUITING', 'HARVEST'];

function loadLifecycleModel({
  rental = {
    rental_id: 12,
    order_id: 11,
    user_id: 3,
    tray_id: 8,
    status: 'ACTIVE',
    order_status: 'PROCESSING',
    payment_status: 'PAID',
  },
  session = {
    session_id: 77,
    rental_id: 12,
    tray_id: 8,
    status: 'ACTIVE',
    start_at: '2026-01-01T00:00:00.000Z',
    harvest_date: '2026-01-21',
  },
  latestProgress = {
    progress_id: 9,
    current_stage: 'HARVEST',
    progress_percent: '80',
  },
  harvestCount = 2,
  totals = [{ unit: 'kg', totalQuantity: '1.5' }],
  sessions = null,
  failOn,
} = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/rental.model');
  const statements = [];
  const client = {
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });
      if (failOn && statement.includes(failOn)) throw new Error('database write failed');
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
      if (statement.startsWith('SELECT r.rental_id, r.order_id, r.user_id')) {
        return { rows: rental ? [rental] : [] };
      }
      if (statement.startsWith('SELECT session_id, rental_id, tray_id, mushroom_type_id')) {
        return { rows: session ? [session] : [] };
      }
      if (statement.startsWith('SELECT tray_id, status FROM cultivation_trays')) {
        return { rows: [{ tray_id: values[0], status: 'OCCUPIED' }] };
      }
      if (statement.startsWith('SELECT progress_id, current_stage, progress_percent')) {
        return { rows: latestProgress ? [latestProgress] : [] };
      }
      if (statement.startsWith('SELECT COUNT(*)::int AS "totalHarvests"')) {
        return { rows: [{ totalHarvests: harvestCount }] };
      }
      if (statement.startsWith('SELECT unit, COALESCE(SUM(quantity), 0)::numeric')) {
        return { rows: totals };
      }
      if (statement.startsWith('SELECT session_id, tray_id, status, start_at')) {
        return { rows: sessions || [session] };
      }
      if (statement.startsWith('INSERT INTO cultivation_progress')) {
        return {
          rows: [{
            progress_id: 10,
            session_id: session.session_id,
            current_stage: values[1],
            progress_percent: values[2],
          }],
        };
      }
      if (statement.startsWith('INSERT INTO harvests')) {
        return { rows: [{ harvest_id: 5, session_id: session.session_id, unit: values[2] || values[3] }] };
      }
      if (statement.startsWith('UPDATE cultivation_sessions SET status = \'COMPLETED\'')) {
        return { rows: [{ session_id: session.session_id, status: 'COMPLETED', end_at: '2026-01-22T00:00:00.000Z' }] };
      }
      if (statement.startsWith('UPDATE rentals SET status = \'COMPLETED\'')) {
        return { rows: [{ status: 'COMPLETED' }] };
      }
      if (statement.startsWith('UPDATE cultivation_trays SET status = \'AVAILABLE\'')) {
        return { rows: [{ tray_id: 8, status: 'AVAILABLE' }] };
      }
      if (statement.startsWith('UPDATE orders SET status = \'COMPLETED\'')) {
        return { rows: [{ status: 'COMPLETED' }] };
      }
      if (statement.startsWith('UPDATE orders SET status = \'CANCELLED\'')) {
        return {
          rows: [{
            status: 'CANCELLED',
            payment_status: rental.payment_status === 'PAID' ? 'REFUND_PENDING' : rental.payment_status,
          }],
        };
      }
      if (statement.startsWith('INSERT INTO notifications')
        || statement.startsWith('UPDATE cultivation_sessions')
        || statement.startsWith('UPDATE rentals')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client };
  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: pool };
  return { model: require('../src/models/rental.model'), statements };
}

test('records monotonic cultivation progress in one transaction', async () => {
  const { model, statements } = loadLifecycleModel({
    latestProgress: { progress_id: 9, current_stage: 'FRUITING', progress_percent: '60' },
  });

  const progress = await model.createProgressForAdmin(
    12,
    { currentStage: 'HARVEST', progressPercent: 80, description: 'Ready to harvest' },
    2,
    stages,
  );

  assert.equal(progress.rentalId, 12);
  assert.equal(progress.sessionId, 77);
  assert.ok(statements.some(({ statement, values }) => (
    statement.startsWith('INSERT INTO cultivation_progress')
      && values[1] === 'HARVEST'
      && values[2] === 80
  )));
  assert.ok(statements.some(({ statement }) => statement === 'COMMIT'));
});

test('rejects progress that moves backwards and rolls back', async () => {
  const { model, statements } = loadLifecycleModel({
    latestProgress: { progress_id: 9, current_stage: 'FRUITING', progress_percent: '80' },
  });

  await assert.rejects(
    () => model.createProgressForAdmin(
      12,
      { currentStage: 'PINNING', progressPercent: 70 },
      2,
      stages,
    ),
    { statusCode: 409 },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_progress')));
});

test('enforces active rentals, harvest-stage progress, and harvests before completion', async () => {
  const inactiveProgress = loadLifecycleModel({
    rental: { rental_id: 12, status: 'PREPARING' },
  });
  await assert.rejects(
    () => inactiveProgress.model.createProgressForAdmin(
      12,
      { currentStage: 'HARVEST', progressPercent: 80 },
      2,
      stages,
    ),
    { statusCode: 409 },
  );

  const notHarvest = loadLifecycleModel({
    latestProgress: { progress_id: 9, current_stage: 'FRUITING', progress_percent: '80' },
  });
  await assert.rejects(
    () => notHarvest.model.createHarvestForAdmin(12, { quantity: 1, unit: 'kg' }, 2),
    { statusCode: 409 },
  );

  const noHarvests = loadLifecycleModel({ harvestCount: 0 });
  await assert.rejects(
    () => noHarvests.model.completeForAdmin(12, undefined, 2),
    { statusCode: 409 },
  );
  assert.ok(!noHarvests.statements.some(({ statement }) => (
    statement.startsWith("UPDATE cultivation_sessions SET status = 'COMPLETED'")
  )));
});

test('records harvests and returns totals grouped by unit', async () => {
  const { model, statements } = loadLifecycleModel({
    totals: [
      { unit: 'kg', totalQuantity: '1.5' },
      { unit: 'bag', totalQuantity: '4' },
    ],
  });

  const result = await model.createHarvestForAdmin(12, {
    quantity: 0.5,
    unit: 'kg',
    qualityGrade: 'A',
  }, 2);

  assert.equal(result.totalHarvests, 2);
  assert.deepEqual(result.totals, [
    { unit: 'kg', totalQuantity: 1.5 },
    { unit: 'bag', totalQuantity: 4 },
  ]);
  assert.ok(statements.some(({ statement }) => statement.startsWith('INSERT INTO harvests')));
  assert.ok(statements.some(({ statement, values }) => (
    statement.startsWith('INSERT INTO notifications')
      && values[1] === 'HARVEST_RECORDED'
      && values[4] === 12
  )));
});

test('completes a harvested rental, or rolls back after a failed write', async () => {
  const success = loadLifecycleModel();
  const result = await success.model.completeForAdmin(12, 'Done', 2);

  assert.deepEqual(result, {
    rentalId: 12,
    rentalStatus: 'COMPLETED',
    orderStatus: 'COMPLETED',
    session: { sessionId: 77, status: 'COMPLETED', endAt: '2026-01-22T00:00:00.000Z' },
    tray: { trayId: 8, status: 'AVAILABLE' },
    harvestSummary: { totalHarvests: 2, totals: [{ unit: 'kg', totalQuantity: 1.5 }] },
  });
  assert.ok(!success.statements.some(({ statement }) => statement.includes('rental_status_logs')));

  const failure = loadLifecycleModel({ failOn: "UPDATE rentals SET status = 'COMPLETED'" });
  await assert.rejects(() => failure.model.completeForAdmin(12, undefined, 2), /database write failed/);
  assert.ok(failure.statements.some(({ statement }) => statement === 'ROLLBACK'));
});

test('cancels an active rental, marks paid orders for refund, and releases its tray', async () => {
  const { model, statements } = loadLifecycleModel();
  const result = await model.cancelForAdmin(12, 'Customer requested cancellation', 1);

  assert.deepEqual(result, {
    rentalId: 12,
    rentalStatus: 'CANCELLED',
    orderStatus: 'CANCELLED',
    paymentStatus: 'REFUND_PENDING',
    refundRequired: true,
  });
  assert.ok(statements.some(({ statement }) => (
    statement.startsWith("UPDATE cultivation_trays SET status = 'AVAILABLE'")
  )));
  assert.ok(!statements.some(({ statement }) => statement.includes('rental_status_logs')));
});

test('cancellation releases the active session tray when the rental tray reference is stale', async () => {
  const { model, statements } = loadLifecycleModel({
    rental: {
      rental_id: 12,
      order_id: 11,
      user_id: 3,
      tray_id: 8,
      status: 'ACTIVE',
      order_status: 'PROCESSING',
      payment_status: 'PAID',
    },
    session: {
      session_id: 77,
      rental_id: 12,
      tray_id: 9,
      status: 'ACTIVE',
      start_at: '2026-01-01T00:00:00.000Z',
      harvest_date: '2026-01-21',
    },
  });

  await model.cancelForAdmin(12, 'Customer requested cancellation', 1);

  assert.ok(statements.some(({ statement, values }) => (
    statement.startsWith("UPDATE cultivation_trays SET status = 'AVAILABLE'")
      && values[0] === 9
  )));
});

test('rejects completed rentals and only requires a refund for paid cancellations', async () => {
  const completed = loadLifecycleModel({
    rental: {
      rental_id: 12,
      order_id: 11,
      user_id: 3,
      tray_id: 8,
      status: 'COMPLETED',
      order_status: 'COMPLETED',
      payment_status: 'PAID',
    },
  });
  await assert.rejects(
    () => completed.model.cancelForAdmin(12, 'No longer needed', 1),
    { statusCode: 409 },
  );

  const unpaid = loadLifecycleModel({
    rental: {
      rental_id: 12,
      order_id: 11,
      user_id: 3,
      tray_id: 8,
      status: 'CONFIRMED',
      order_status: 'CONFIRMED',
      payment_status: 'UNPAID',
    },
    sessions: [],
  });
  const result = await unpaid.model.cancelForAdmin(12, 'No longer needed', 1);
  assert.equal(result.paymentStatus, 'UNPAID');
  assert.equal(result.refundRequired, false);
  assert.ok(!unpaid.statements.some(({ statement }) => (
    statement.startsWith("UPDATE cultivation_trays SET status = 'AVAILABLE'")
  )));
});
