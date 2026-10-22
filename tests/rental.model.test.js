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

test('blocks lifecycle status changes through PATCH', async () => {
  for (const [status, endpoint] of [
    ['ACTIVE', 'cultivation-session'],
    ['COMPLETED', 'complete'],
    ['CANCELLED', 'cancel'],
  ]) {
    const { model, statements } = loadRentalModel();
    await assert.rejects(
      () => model.updateForAdmin(12, { status }),
      { statusCode: 409, message: new RegExp(endpoint) },
    );
    assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
    assert.ok(!statements.some(({ statement }) => statement.startsWith('UPDATE rentals')));
  }
});

test('approves a confirmed rental and sends the approval notification', async () => {
  const { model, statements } = loadRentalModel({
    rental: {
      rental_id: 12,
      order_id: 11,
      status: 'CONFIRMED',
      tray_id: null,
      duration_days: 30,
      start_date: null,
      end_date: null,
      payment_status: 'PAID',
    },
  });

  await model.updateForAdmin(12, { status: 'PREPARING' }, 1);

  assert.ok(!statements.some(({ statement }) => statement.includes('rental_status_logs')));
  assert.ok(statements.some(({ statement, values }) => (
    statement.startsWith('INSERT INTO notifications')
      && values[1] === 'RENTAL_APPROVED'
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
