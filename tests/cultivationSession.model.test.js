const test = require('node:test');
const assert = require('node:assert/strict');

function loadInspectionModel({
  assignment = {
    session_tray_id: 14,
    session_id: 77,
    assignment_status: 'ACTIVE',
    session_status: 'CULTIVATING',
    start_at: '2026-10-01T00:00:00.000Z',
    harvest_date: '2026-10-21',
  },
  latestProgress = { progress_id: 9, current_stage: 'FRUITING_INITIATION', progress_percent: '40' },
} = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/cultivationSession.model');
  const statements = [];
  const client = {
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
      if (statement.startsWith('SELECT st.session_tray_id, st.session_id')) {
        return { rows: assignment ? [assignment] : [] };
      }
      if (statement.startsWith('SELECT progress_id, current_stage, progress_percent')) {
        return { rows: latestProgress ? [latestProgress] : [] };
      }
      if (statement.startsWith('INSERT INTO cultivation_inspections')) {
        return {
          rows: [{
            inspection_id: 20,
            session_tray_id: values[0],
            inspected_by: values[1],
            growth_stage: values[2],
            growth_progress: values[5],
            notes: values[6],
          }],
        };
      }
      if (statement.startsWith('INSERT INTO cultivation_progress')) {
        return {
          rows: [{
            progress_id: 21,
            session_id: values[0],
            current_stage: values[1],
            progress_percent: values[2],
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    },
    release: () => {},
  };
  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: { connect: async () => client } };
  return { model: require('../src/models/cultivationSession.model'), statements };
}

function loadWorkflowModel({
  session = {
    session_id: 77,
    status: 'READY_FOR_CULTIVATION',
    harvest_status: 'NOT_READY',
    tray_quantity: 2,
    duration_days: 20,
    start_at: '2026-10-01T00:00:00.000Z',
    harvest_date: '2026-10-21',
  },
  activeAssignments = [],
  floor = { floor_id: 2, floor_name: 'Floor 2', status: 'ACTIVE' },
  selectedTrays = [
    { tray_id: 10, tray_code: 'F2-TRAY-01', tray_name: 'Tray 1', floor_id: 2, status: 'AVAILABLE' },
    { tray_id: 11, tray_code: 'F2-TRAY-02', tray_name: 'Tray 2', floor_id: 2, status: 'AVAILABLE' },
  ],
  occupiedAssignments = [],
  occupiedTrayIds,
  latestProgress = { progress_id: 9, current_stage: 'MATURATION', progress_percent: '100' },
  maturityInspection = { inspection_id: 20 },
} = {}) {
  const dbPath = require.resolve('../src/config/db');
  const modelPath = require.resolve('../src/models/cultivationSession.model');
  const statements = [];
  let insertedAssignments = 0;
  const client = {
    query: async (query, values = []) => {
      const statement = query.trim().replace(/\s+/g, ' ');
      statements.push({ statement, values });
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(statement)) return { rows: [] };
      if (statement.startsWith('SELECT s.session_id, s.order_item_id')) return { rows: [session] };
      if (statement.startsWith('SELECT session_tray_id, tray_id FROM cultivation_session_trays')) {
        return { rows: activeAssignments };
      }
      if (statement.startsWith('SELECT session_tray_id FROM cultivation_session_trays')) {
        return { rows: activeAssignments };
      }
      if (statement.startsWith('SELECT floor_id, floor_name, status FROM cultivation_floors')) {
        return { rows: floor ? [floor] : [] };
      }
      if (statement.startsWith('SELECT t.tray_id, t.tray_code, t.tray_name, t.floor_id, t.status')) {
        return { rows: selectedTrays };
      }
      if (statement.startsWith('SELECT tray_id FROM cultivation_session_trays')) {
        return { rows: occupiedAssignments };
      }
      if (statement.startsWith('UPDATE cultivation_trays')) {
        const ids = occupiedTrayIds ?? values[0];
        return { rows: ids.map((trayId) => ({ tray_id: trayId })) };
      }
      if (statement.startsWith('INSERT INTO cultivation_session_trays')) {
        insertedAssignments += 1;
        return {
          rows: [{
            session_tray_id: insertedAssignments,
            session_id: values[0],
            tray_id: values[1],
            status: 'ACTIVE',
          }],
        };
      }
      if (statement.startsWith("UPDATE cultivation_sessions SET status = 'CULTIVATING'")) {
        return {
          rows: [{
            session_id: 77,
            status: 'CULTIVATING',
            start_at: '2026-11-01T00:00:00.000Z',
            harvest_date: '2026-11-21',
            harvest_status: 'NOT_READY',
          }],
        };
      }
      if (statement.startsWith('SELECT progress_id, current_stage, progress_percent')) {
        return { rows: latestProgress ? [latestProgress] : [] };
      }
      if (statement.startsWith('SELECT ci.inspection_id')) {
        return { rows: maturityInspection ? [maturityInspection] : [] };
      }
      if (statement.startsWith("UPDATE cultivation_sessions SET harvest_status = 'HARVEST_READY'")) {
        return {
          rows: [{
            session_id: 77,
            status: 'CULTIVATING',
            harvest_status: 'HARVEST_READY',
          }],
        };
      }
      if (statement.startsWith('INSERT INTO cultivation_progress')) return { rows: [] };
      throw new Error(`Unexpected SQL: ${statement}`);
    },
    release: () => {},
  };
  delete require.cache[dbPath];
  delete require.cache[modelPath];
  require.cache[dbPath] = { exports: { connect: async () => client } };
  return { model: require('../src/models/cultivationSession.model'), statements };
}

test('daily tray inspection records inspection and session progress transactionally', async () => {
  const { model, statements } = loadInspectionModel();
  const result = await model.createInspectionForAdmin(14, {
    growthStage: 'PINNING',
    growthProgress: 65,
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
    notes: 'Pins are developing normally.',
  }, 3);

  assert.equal(result.inspection.session_tray_id, 14);
  assert.equal(result.inspection.inspected_by, 3);
  assert.equal(result.inspection.growth_stage, 'PINNING');
  assert.equal(result.progress.session_id, 77);
  assert.equal(result.progress.progress_percent, 65);
  assert.ok(statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_inspections')));
  assert.ok(statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_progress')));
  assert.equal(statements.at(-1).statement, 'COMMIT');
});

test('allows the remaining forward cultivation growth-stage transitions', async () => {
  const transitions = [
    ['PINNING', 'YOUNG_FRUITING', 75],
    ['YOUNG_FRUITING', 'MATURATION', 100],
  ];

  for (const [previousStage, nextStage, progress] of transitions) {
    const { model } = loadInspectionModel({
      latestProgress: { progress_id: 9, current_stage: previousStage, progress_percent: '60' },
    });
    const result = await model.createInspectionForAdmin(14, {
      growthStage: nextStage,
      growthProgress: progress,
    }, 3);
    assert.equal(result.progress.current_stage, nextStage);
  }
});

test('does not record inspections for a released or completed tray assignment', async () => {
  const { model, statements } = loadInspectionModel({
    assignment: {
      session_tray_id: 14,
      session_id: 77,
      assignment_status: 'RELEASED',
      session_status: 'COMPLETED',
    },
  });

  await assert.rejects(
    () => model.createInspectionForAdmin(14, {
      growthStage: 'MATURATION',
      growthProgress: 100,
    }, 3),
    { statusCode: 409, message: 'Only active session trays can be inspected' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_inspections')));
});

test('rejects a daily growth-stage regression', async () => {
  const { model, statements } = loadInspectionModel({
    latestProgress: { progress_id: 9, current_stage: 'MATURATION', progress_percent: '70' },
  });
  await assert.rejects(
    () => model.createInspectionForAdmin(14, {
      growthStage: 'PINNING',
      growthProgress: 70,
    }, 3),
    { statusCode: 409, message: 'growthStage cannot be earlier than the latest stage' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
});

test('assigns only the Farm Operator selected trays on the selected floor transactionally', async () => {
  const { model, statements } = loadWorkflowModel();
  const result = await model.assignTraysForAdmin(77, { floorId: 2, trayIds: [10, 11] });

  assert.equal(result.session_id, 77);
  assert.deepEqual(result.floor, { floor_id: 2, floor_name: 'Floor 2' });
  assert.equal(result.required_trays, 2);
  assert.equal(result.assigned_trays_count, 2);
  assert.deepEqual(result.assigned_trays.map((tray) => tray.tray_id), [10, 11]);
  assert.deepEqual(result.assigned_trays.map((tray) => tray.tray_code), ['F2-TRAY-01', 'F2-TRAY-02']);
  assert.equal(statements.filter(({ statement }) => statement.startsWith('UPDATE cultivation_trays')).length, 1);
  assert.equal(statements.filter(({ statement }) => statement.startsWith('INSERT INTO cultivation_session_trays')).length, 2);
  assert.ok(statements.some(({ statement }) => statement.includes('FOR UPDATE OF t')));
  assert.equal(statements.at(-1).statement, 'COMMIT');
});

test('rejects a selected tray count that does not equal the session requirement before writes', async () => {
  const { model, statements } = loadWorkflowModel();

  await assert.rejects(
    () => model.assignTraysForAdmin(77, { floorId: 2, trayIds: [10] }),
    { statusCode: 409, code: 'INVALID_TRAY_QUANTITY' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement === 'COMMIT'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('UPDATE cultivation_trays')));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_session_trays')));
});

test('rejects missing, wrong-floor, unavailable, and already-active selected trays atomically', async () => {
  const missing = loadWorkflowModel({
    selectedTrays: [{ tray_id: 10, tray_code: 'F2-TRAY-01', floor_id: 2, status: 'AVAILABLE' }],
  });
  await assert.rejects(
    () => missing.model.assignTraysForAdmin(77, { floorId: 2, trayIds: [10, 999999] }),
    { statusCode: 404, code: 'TRAY_NOT_FOUND' },
  );
  assert.ok(!missing.statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_session_trays')));

  const wrongFloor = loadWorkflowModel({
    selectedTrays: [
      { tray_id: 10, tray_code: 'F2-TRAY-01', floor_id: 2, status: 'AVAILABLE' },
      { tray_id: 11, tray_code: 'F3-TRAY-01', floor_id: 3, status: 'AVAILABLE' },
    ],
  });
  await assert.rejects(
    () => wrongFloor.model.assignTraysForAdmin(77, { floorId: 2, trayIds: [10, 11] }),
    { statusCode: 409, code: 'TRAY_FLOOR_MISMATCH' },
  );
  assert.ok(!wrongFloor.statements.some(({ statement }) => statement.startsWith('UPDATE cultivation_trays')));

  const unavailable = loadWorkflowModel({
    selectedTrays: [
      { tray_id: 10, tray_code: 'F2-TRAY-01', floor_id: 2, status: 'AVAILABLE' },
      { tray_id: 11, tray_code: 'F2-TRAY-02', floor_id: 2, status: 'OCCUPIED' },
    ],
  });
  await assert.rejects(
    () => unavailable.model.assignTraysForAdmin(77, { floorId: 2, trayIds: [10, 11] }),
    { statusCode: 409, code: 'TRAY_UNAVAILABLE' },
  );
  assert.ok(!unavailable.statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_session_trays')));

  const activeElsewhere = loadWorkflowModel({ occupiedAssignments: [{ tray_id: 10 }] });
  await assert.rejects(
    () => activeElsewhere.model.assignTraysForAdmin(77, { floorId: 2, trayIds: [10, 11] }),
    { statusCode: 409, code: 'TRAY_UNAVAILABLE' },
  );
  assert.ok(activeElsewhere.statements.some(({ statement }) => statement === 'ROLLBACK'));
});

test('rolls back when the selected tray update changes during assignment', async () => {
  const { model, statements } = loadWorkflowModel({ occupiedTrayIds: [10] });

  await assert.rejects(
    () => model.assignTraysForAdmin(77, { floorId: 2, trayIds: [10, 11] }),
    { statusCode: 409, code: 'TRAY_UNAVAILABLE' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_session_trays')));
});

test('rejects selected trays when the session is not ready for cultivation', async () => {
  const { model, statements } = loadWorkflowModel({
    session: { session_id: 77, status: 'SPAWN_RESTING', tray_quantity: 2 },
  });
  await assert.rejects(
    () => model.assignTraysForAdmin(77, { floorId: 2, trayIds: [10, 11] }),
    { statusCode: 409, code: 'INVALID_SESSION_STATUS' },
  );
  assert.ok(!statements.some(({ statement }) => statement.startsWith('UPDATE cultivation_trays')));
});

test('activates only after all trays are assigned and creates FRUITING_INITIATION progress', async () => {
  const { model, statements } = loadWorkflowModel({
    activeAssignments: [{ session_tray_id: 1 }, { session_tray_id: 2 }],
  });
  const session = await model.activateForAdmin(77);

  assert.equal(session.status, 'CULTIVATING');
  assert.ok(statements.some(({ statement, values }) => statement.startsWith('INSERT INTO cultivation_progress')
    && values[0] === 77 && values[2] === 'Cultivation activated'));

  const missing = loadWorkflowModel({ activeAssignments: [{ session_tray_id: 1 }] });
  await assert.rejects(
    () => missing.model.activateForAdmin(77),
    { statusCode: 409, code: 'TRAYS_NOT_ASSIGNED' },
  );
});

test('marks only a mature, inspected cultivation session harvest ready without harvesting', async () => {
  const { model, statements } = loadWorkflowModel({
    session: {
      session_id: 77,
      status: 'CULTIVATING',
      harvest_status: 'NOT_READY',
      tray_quantity: 2,
    },
  });
  const result = await model.markHarvestReadyForAdmin(77);
  assert.deepEqual(result, {
    session_id: 77,
    status: 'CULTIVATING',
    harvest_status: 'HARVEST_READY',
  });
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO harvests')));

  const premature = loadWorkflowModel({
    session: { session_id: 77, status: 'CULTIVATING', harvest_status: 'NOT_READY', tray_quantity: 2 },
    latestProgress: { progress_id: 9, current_stage: 'YOUNG_FRUITING', progress_percent: '80' },
  });
  await assert.rejects(
    () => premature.model.markHarvestReadyForAdmin(77),
    { statusCode: 409, code: 'HARVEST_NOT_READY' },
  );

  const repeated = loadWorkflowModel({
    session: { session_id: 77, status: 'CULTIVATING', harvest_status: 'HARVEST_READY', tray_quantity: 2 },
  });
  await assert.rejects(
    () => repeated.model.markHarvestReadyForAdmin(77),
    { statusCode: 409, code: 'ALREADY_HARVEST_READY' },
  );
});
