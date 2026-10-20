const test = require('node:test');
const assert = require('node:assert/strict');

function loadRentalModel({
  rental = {
    rental_id: 12,
    order_id: 11,
    status: 'PREPARING',
    tray_id: null,
    duration_days: 30,
    start_date: '2026-04-01T00:00:00.000Z',
    end_date: '2026-05-01T00:00:00.000Z',
    payment_status: 'PAID',
  },
  tray = { tray_id: 8, status: 'AVAILABLE' },
  conflict = false,
} = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/rental.model');
  const statements = [];
  const client = {
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
      if (statement.startsWith('SELECT r.rental_id, r.order_id, r.status')) {
        return { rows: rental ? [rental] : [] };
      }
      if (statement.startsWith('SELECT tray_id, status')) {
        return { rows: tray ? [tray] : [] };
      }
      if (statement.startsWith('SELECT rental_id FROM rentals')) {
        return { rows: conflict ? [{ rental_id: 99 }] : [] };
      }
      if (statement.startsWith('UPDATE rentals')) return { rows: [{ rental_id: values[0] }] };
      return { rows: [] };
    },
    release: () => {},
  };
  const pool = {
    connect: async () => client,
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });
      if (statement.includes('WHERE r.rental_id = $1')) {
        return { rows: [{ rental_id: values[0], status: 'ACTIVE', tray_id: 8 }] };
      }
      return { rows: [] };
    },
  };
  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: pool };
  return { model: require('../src/models/rental.model'), statements };
}

test('activates a paid preparing rental, assigns its tray, and marks tray occupied transactionally', async () => {
  const { model, statements } = loadRentalModel();

  const rental = await model.updateForAdmin(12, { status: 'ACTIVE', trayId: 8 });

  assert.equal(rental.status, 'ACTIVE');
  assert.equal(rental.tray_id, 8);
  assert.ok(statements.some(({ statement }) => (
    statement === "UPDATE cultivation_trays SET status = 'OCCUPIED', updated_at = NOW() WHERE tray_id = $1"
  )));
  assert.ok(statements.some(({ statement }) => statement === 'COMMIT'));
});

test('rejects activating an unpaid rental', async () => {
  const { model, statements } = loadRentalModel({
    rental: {
      rental_id: 12,
      order_id: 11,
      status: 'PREPARING',
      tray_id: null,
      duration_days: 30,
      start_date: '2026-04-01T00:00:00.000Z',
      end_date: '2026-05-01T00:00:00.000Z',
      payment_status: 'UNPAID',
    },
  });

  await assert.rejects(
    () => model.updateForAdmin(12, { status: 'ACTIVE', trayId: 8 }),
    { statusCode: 409, message: 'Only rentals with paid orders can be activated' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('UPDATE rentals')));
});

test('rejects activation when the tray is occupied or overlaps another rental', async () => {
  const occupiedTray = loadRentalModel({ tray: { tray_id: 8, status: 'OCCUPIED' } });
  await assert.rejects(
    () => occupiedTray.model.updateForAdmin(12, { status: 'ACTIVE', trayId: 8 }),
    { statusCode: 409, message: 'Cultivation tray is unavailable' },
  );

  const overlap = loadRentalModel({ conflict: true });
  await assert.rejects(
    () => overlap.model.updateForAdmin(12, { status: 'ACTIVE', trayId: 8 }),
    { statusCode: 409, message: /overlapping active rental/ },
  );
  assert.ok(overlap.statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!overlap.statements.some(({ statement }) => statement.startsWith('UPDATE rentals')));
});

test('completing an active rental releases its occupied tray', async () => {
  const { model, statements } = loadRentalModel({
    rental: {
      rental_id: 12,
      order_id: 11,
      status: 'ACTIVE',
      tray_id: 8,
      duration_days: 30,
      start_date: '2026-04-01T00:00:00.000Z',
      end_date: '2026-05-01T00:00:00.000Z',
      payment_status: 'PAID',
    },
  });

  await model.updateForAdmin(12, { status: 'COMPLETED' });

  assert.ok(statements.some(({ statement, values }) => (
    statement === "UPDATE cultivation_trays SET status = 'AVAILABLE', updated_at = NOW() WHERE tray_id = $1 AND status = 'OCCUPIED'"
      && values[0] === 8
  )));
  assert.ok(statements.some(({ statement }) => statement === 'COMMIT'));
});
