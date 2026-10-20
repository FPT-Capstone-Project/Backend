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
  tray = { tray_id: 8, status: 'AVAILABLE', floor_id: 2 },
  floor = { floor_id: 2, status: 'ACTIVE' },
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
      if (statement.startsWith('SELECT r.rental_id, r.order_id, r.user_id')) {
        return {
          rows: rental ? [{
            ...rental,
            user_id: 3,
            order_status: 'CONFIRMED',
          }] : [],
        };
      }
      if (statement.startsWith('SELECT t.tray_id, t.status, t.floor_id')
        || statement.startsWith('SELECT tray_id, status')) {
        return { rows: tray ? [tray] : [] };
      }
      if (statement.startsWith('SELECT floor_id, status')) {
        return { rows: floor ? [floor] : [] };
      }
      if (statement.startsWith('SELECT oi.order_item_id, oi.mushroom_type_id')) {
        return { rows: [{ order_item_id: 15, mushroom_type_id: 9 }] };
      }
      if (statement.startsWith('SELECT mushroom_type_id, name, growing_days, status')) {
        return { rows: [{ mushroom_type_id: 9, name: 'Oyster', growing_days: 20, status: 'ACTIVE' }] };
      }
      if (statement.startsWith('SELECT session_id FROM cultivation_sessions')) {
        return { rows: conflict ? [{ session_id: 66 }] : [] };
      }
      if (statement.startsWith('INSERT INTO cultivation_sessions')) {
        return {
          rows: [{
            session_id: 77,
            rental_id: values[0],
            tray_id: values[1],
            mushroom_type_id: values[2],
            duration_days: values[3],
            status: 'ACTIVE',
          }],
        };
      }
      if (statement.startsWith('UPDATE cultivation_trays')) return { rows: [] };
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
        return {
          rows: [{
            rental_id: values[0],
            status: 'ACTIVE',
            tray_id: 8,
            customer_name: 'Customer',
            mushroom_type_id: 9,
            mushroom_name: 'Oyster',
          }],
        };
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

test('starts cultivation atomically, derives the mushroom, and activates the rental and tray', async () => {
  const { model, statements } = loadRentalModel();

  const result = await model.startCultivationForAdmin(12, 8);

  assert.equal(result.session.session_id, 77);
  assert.equal(result.session.rental_id, 12);
  assert.equal(result.session.tray_id, 8);
  assert.equal(result.session.mushroom_type_id, 9);
  assert.equal(result.session.duration_days, 20);
  const orderItemRead = statements.find(({ statement }) => (
    statement.startsWith('SELECT oi.order_item_id, oi.mushroom_type_id')
  ));
  assert.deepEqual(orderItemRead.values, [11]);
  const mushroomRead = statements.find(({ statement }) => (
    statement.startsWith('SELECT mushroom_type_id, name, growing_days, status')
  ));
  assert.deepEqual(mushroomRead.values, [9]);
  const sessionInsert = statements.find(({ statement }) => (
    statement.startsWith('INSERT INTO cultivation_sessions')
  ));
  assert.match(sessionInsert.statement, /CURRENT_DATE \+ \$4::integer/);
  assert.equal(result.rental.status, 'ACTIVE');
  assert.equal(result.rental.tray_id, 8);
  assert.ok(statements.some(({ statement }) => (
    statement.startsWith('UPDATE rentals SET tray_id = $2, status = \'ACTIVE\'')
  )));
  assert.ok(statements.some(({ statement }) => (
    statement.startsWith("UPDATE cultivation_trays SET status = 'OCCUPIED'")
  )));
  assert.ok(statements.some(({ statement }) => statement === 'COMMIT'));
});

test('does not start cultivation when the tray is occupied or session already exists', async () => {
  const occupiedTray = loadRentalModel({ tray: { tray_id: 8, status: 'OCCUPIED' } });
  await assert.rejects(
    () => occupiedTray.model.startCultivationForAdmin(12, 8),
    { statusCode: 409, message: 'Cultivation tray is unavailable' },
  );
  assert.ok(!occupiedTray.statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_sessions')));

  const existingSession = loadRentalModel({ conflict: true });
  await assert.rejects(
    () => existingSession.model.startCultivationForAdmin(12, 8),
    { statusCode: 409, message: 'Rental or tray already has a cultivation session' },
  );
  assert.ok(existingSession.statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!existingSession.statements.some(({ statement }) => statement.startsWith('UPDATE rentals')));
});

test('requires an assigned active floor before starting cultivation', async () => {
  const unassigned = loadRentalModel({ tray: { tray_id: 8, status: 'AVAILABLE', floor_id: null } });
  await assert.rejects(
    () => unassigned.model.startCultivationForAdmin(12, 8),
    { statusCode: 409, message: 'Assign the cultivation tray to a floor before starting cultivation' },
  );
  assert.ok(!unassigned.statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_sessions')));

  const inactiveFloor = loadRentalModel({
    floor: { floor_id: 2, status: 'INACTIVE' },
  });
  await assert.rejects(
    () => inactiveFloor.model.startCultivationForAdmin(12, 8),
    { statusCode: 409, message: 'Cultivation tray floor is not active' },
  );
  assert.ok(!inactiveFloor.statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_sessions')));
});
