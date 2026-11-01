const test = require('node:test');
const assert = require('node:assert/strict');

function loadService() {
  const modelPath = require.resolve('../src/models/cultivationSession.model');
  const cloudinaryPath = require.resolve('../src/services/cloudinary.service');
  const servicePath = require.resolve('../src/services/cultivationSession.service');
  const calls = [];
  const uploads = [];
  const model = {
    createInspectionForAdmin: async (...args) => {
      calls.push(args);
      return { inspection: { inspection_id: 1 }, progress: { progress_id: 1 } };
    },
    createHarvestForAdmin: async (...args) => {
      calls.push(args);
      return { harvest_id: 1 };
    },
    assignTraysForAdmin: async (...args) => {
      calls.push(args);
      return { assignments: [{ session_tray_id: 1 }] };
    },
    findAvailableTraysForAdmin: async (...args) => {
      calls.push(args);
      return [{ tray_id: 10, status: 'AVAILABLE' }];
    },
    findProgressForAdmin: async (...args) => {
      calls.push(args);
      return [{
        progress_id: 3,
        current_stage: 'PINNING',
        progress_percent: 40,
      }];
    },
    activateForAdmin: async (...args) => {
      calls.push(args);
      return { session_id: 1, status: 'CULTIVATING' };
    },
    markHarvestReadyForAdmin: async (...args) => {
      calls.push(args);
      return { session_id: 1, status: 'CULTIVATING', harvest_status: 'HARVEST_READY' };
    },
    createIncidentForAdmin: async (...args) => {
      calls.push(args);
      return { issue_id: 1, issue_type: args[1].incidentType };
    },
    findByIdForAdmin: async (sessionId) => ({
      session_id: sessionId,
      status: 'CULTIVATING',
      harvest_status: 'NOT_READY',
      harvest_date: '2026-11-21',
    }),
    findIncidentsForAdmin: async (...args) => {
      calls.push(args);
      return [{ issue_id: 1 }];
    },
    findInspectionForImage: async (...args) => {
      calls.push(args);
      return { inspection_id: args[0] };
    },
    createInspectionImage: async (...args) => {
      calls.push(args);
      return { image_id: 1, inspection_id: args[0], image_url: args[1], caption: args[2] };
    },
  };
  delete require.cache[modelPath];
  delete require.cache[cloudinaryPath];
  delete require.cache[servicePath];
  require.cache[modelPath] = { exports: model };
  require.cache[cloudinaryPath] = {
    exports: {
      uploadImage: async (...args) => {
        uploads.push(args);
        return 'https://images.example.test/cultivation.jpg';
      },
    },
  };
  return { service: require('../src/services/cultivationSession.service'), calls, uploads };
}

test('validates daily inspection input and passes the Farm Operator ID', async () => {
  const { service, calls } = loadService();
  const result = await service.createInspectionForAdmin('14', {
    growthStage: 'fruiting_initiation',
    growthProgress: '65',
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
  }, '3');

  assert.equal(result.inspection.inspection_id, 1);
  assert.deepEqual(calls, [[14, {
    growthStage: 'FRUITING_INITIATION',
    growthProgress: 65,
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
    notes: undefined,
  }, 3]]);
  await assert.rejects(
    () => service.createInspectionForAdmin('14', { growthStage: 'FRUITING_INITIATION', growthProgress: 101 }, '3'),
    { statusCode: 400, message: 'growthProgress must be at most 100' },
  );
});

test('delegates tray assignment, activation, and harvest readiness with parsed session IDs', async () => {
  const { service, calls } = loadService();

  await service.assignTraysForAdmin('7');
  await service.activateForAdmin('7');
  const ready = await service.markHarvestReadyForAdmin('7');

  assert.deepEqual(calls, [[7], [7], [7]]);
  assert.deepEqual(ready, {
    session_id: 1,
    status: 'CULTIVATING',
    harvest_status: 'HARVEST_READY',
  });
});

test('lists currently assignable trays and returns immutable cultivation progress history', async () => {
  const { service, calls } = loadService();

  const trays = await service.getAvailableTraysForAdmin();
  const progress = await service.getProgressForAdmin('7');

  assert.deepEqual(trays, [{ tray_id: 10, status: 'AVAILABLE' }]);
  assert.equal(progress.session_id, 7);
  assert.equal(progress.current_stage, 'PINNING');
  assert.deepEqual(calls, [[], [7]]);
});

test('validates and records cultivation incidents through the existing issue history', async () => {
  const { service, calls } = loadService();
  const incident = await service.createIncidentForAdmin('7', {
    sessionTrayId: '14',
    incidentType: 'slow_growth',
    severity: 'high',
    description: 'Growth remains below the expected rate.',
  }, '3');

  assert.equal(incident.issue_type, 'SLOW_GROWTH');
  assert.deepEqual(calls[0], [7, {
    sessionTrayId: 14,
    inspectionId: undefined,
    incidentType: 'SLOW_GROWTH',
    title: 'SLOW GROWTH',
    description: 'Growth remains below the expected rate.',
    severity: 'HIGH',
    actionTaken: undefined,
    nextAction: undefined,
  }, 3]);
  assert.deepEqual(await service.listIncidentsForAdmin('7'), [{ issue_id: 1 }]);
  const other = await service.createIncidentForAdmin('7', {
    sessionTrayId: 14,
    incidentType: 'OTHER',
  }, '3');
  assert.equal(other.issue_type, 'OTHER');
});

test('uploads cultivation inspection images through the existing image relation', async () => {
  const { service, calls, uploads } = loadService();
  const image = await service.addInspectionImageForAdmin('14', { buffer: Buffer.from('image') }, {
    caption: 'Maturation sample',
  });

  assert.equal(image.inspection_id, 14);
  assert.deepEqual(uploads, [[{ buffer: Buffer.from('image') }, 'cultivation-inspections']]);
  assert.deepEqual(calls, [
    [14],
    [14, 'https://images.example.test/cultivation.jpg', 'Maturation sample'],
  ]);
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
