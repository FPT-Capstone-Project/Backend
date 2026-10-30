const test = require('node:test');
const assert = require('node:assert/strict');

function loadInspectionModel({
  assignment = {
    session_tray_id: 14,
    session_id: 77,
    assignment_status: 'ACTIVE',
    session_status: 'ACTIVE',
    start_at: '2026-10-01T00:00:00.000Z',
    harvest_date: '2026-10-21',
  },
  latestProgress = { progress_id: 9, current_stage: 'INCUBATION', progress_percent: '40' },
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

test('daily tray inspection records inspection and session progress transactionally', async () => {
  const { model, statements } = loadInspectionModel();
  const result = await model.createInspectionForAdmin(14, {
    growthStage: 'FRUITING',
    growthProgress: 65,
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
    notes: 'Pins are developing normally.',
  }, 3);

  assert.equal(result.inspection.session_tray_id, 14);
  assert.equal(result.inspection.inspected_by, 3);
  assert.equal(result.inspection.growth_stage, 'FRUITING');
  assert.equal(result.progress.session_id, 77);
  assert.equal(result.progress.progress_percent, 65);
  assert.ok(statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_inspections')));
  assert.ok(statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_progress')));
  assert.equal(statements.at(-1).statement, 'COMMIT');
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
      growthStage: 'HARVEST',
      growthProgress: 100,
    }, 3),
    { statusCode: 409, message: 'Only active session trays can be inspected' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
  assert.ok(!statements.some(({ statement }) => statement.startsWith('INSERT INTO cultivation_inspections')));
});

test('rejects a daily progress update that moves backwards', async () => {
  const { model, statements } = loadInspectionModel({
    latestProgress: { progress_id: 9, current_stage: 'FRUITING', progress_percent: '70' },
  });
  await assert.rejects(
    () => model.createInspectionForAdmin(14, {
      growthStage: 'PINNING',
      growthProgress: 65,
    }, 3),
    { statusCode: 409, message: 'progressPercent cannot be lower than the latest progress' },
  );
  assert.ok(statements.some(({ statement }) => statement === 'ROLLBACK'));
});
