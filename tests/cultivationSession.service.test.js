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
    updateInspectionForAdmin: async (...args) => {
      calls.push(args);
      return { inspection: { inspection_id: args[1] } };
    },
    assignTraysForAdmin: async (...args) => {
      calls.push(args);
      return {
        session_id: args[0],
        floor: { floor_id: 2, floor_name: 'Floor 2' },
        assigned_trays: [{ session_tray_id: 1, tray_id: args[1].trayIds[0], status: 'ACTIVE' }],
        required_trays: args[1].trayIds.length,
        assigned_trays_count: args[1].trayIds.length,
      };
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
    findDailyInspectionHistoryForAdmin: async (...args) => {
      calls.push(args);
      return {
        session: { sessionId: args[0] },
        inspections: [{
          inspectionId: 3,
          trayId: 12,
          growthStage: 'PINNING',
          growthProgress: 40,
          trayCondition: 'Clean',
        }],
        total: 1,
      };
    },
    findDailyInspectionHistoryForTray: async (...args) => {
      calls.push(args);
      if (args[1] !== 14) return null;
      return {
        tray: { sessionTrayId: args[1], trayId: 12, trayCode: 'TRAY-12' },
        inspections: [{
          inspectionId: 3,
          growthStage: 'PINNING',
          growthProgress: 40,
          mushroomCondition: 'Healthy',
        }],
        total: 1,
      };
    },
    updateGrowthForAdmin: async (...args) => {
      calls.push(args);
      return { session_id: 1, status: 'CULTIVATING' };
    },
    updateHarvestReadinessForAdmin: async (...args) => {
      calls.push(args);
      return { session_id: 1, status: 'HARVEST_READY', harvest_status: 'HARVEST_READY' };
    },
    createIncidentForAdmin: async (...args) => {
      calls.push(args);
      return { issue_id: 1, issue_type: args[1].incidentType };
    },
    findByIdForAdmin: async (sessionId) => ({
      session_id: sessionId,
      user_id: 7,
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
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
  }, '3');

  assert.equal(result.inspection.inspection_id, 1);
  assert.deepEqual(calls, [[14, {
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
    notes: undefined,
  }, 3]]);
  await assert.rejects(
    () => service.createInspectionForAdmin('14', { trayCondition: 'x'.repeat(501) }, '3'),
    { statusCode: 400, message: 'trayCondition must be at most 500 characters' },
  );
});

test('validates and updates an existing daily tray inspection', async () => {
  const { service, calls } = loadService();
  const result = await service.updateInspectionForAdmin('14', '20', {
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
    notes: 'Corrected observation',
  });

  assert.equal(result.inspection.inspection_id, 20);
  assert.deepEqual(calls, [[14, 20, {
    trayCondition: 'Clean',
    mushroomCondition: 'Healthy',
    notes: 'Corrected observation',
  }]]);
});

test('records a daily inspection and uploads each attached image', async () => {
  const { service, calls, uploads } = loadService();
  const files = [
    { buffer: Buffer.from('image one') },
    { buffer: Buffer.from('image two') },
  ];

  const result = await service.createInspectionWithImagesForAdmin('14', {
    caption: 'Daily check',
  }, '3', files);

  assert.equal(result.inspection.inspection_id, 1);
  assert.equal(result.images.length, 2);
  assert.deepEqual(uploads, files.map(file => [file, 'cultivation-inspections']));
  assert.deepEqual(calls[0], [14, {
    trayCondition: undefined,
    mushroomCondition: undefined,
    notes: undefined,
  }, 3]);
  assert.equal(calls.filter(call => call.length === 1 && call[0] === 1).length, 2);
  assert.equal(calls.filter(call => call[0] === 1 && call[1] === 'https://images.example.test/cultivation.jpg').length, 2);
  assert.ok(calls.filter(call => call[0] === 1 && call[1] === 'https://images.example.test/cultivation.jpg')
    .every(call => call[2] === 'Daily check'));
});

test('validates and delegates explicitly selected floor and trays', async () => {
  const { service, calls } = loadService();

  const assignment = await service.assignTraysForAdmin('7', {
    floorId: '2', trayIds: ['10', 11],
  });

  assert.equal(assignment.floor.floor_id, 2);
  assert.deepEqual(calls, [[7, { floorId: 2, trayIds: [10, 11] }]]);
  await assert.rejects(
    () => service.assignTraysForAdmin('7', { floorId: 2, trayIds: [10, 10] }),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.assignTraysForAdmin('7', { floorId: 2, trayIds: [] }),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.assignTraysForAdmin('7', {}),
    { statusCode: 400 },
  );
});

test('lists currently assignable trays and returns immutable cultivation progress history', async () => {
  const { service, calls } = loadService();

  const trays = await service.getAvailableTraysForAdmin({ floorId: '2' });
  const progress = await service.getProgressForAdmin('7');

  assert.deepEqual(trays, [{ tray_id: 10, status: 'AVAILABLE' }]);
  assert.equal(progress.session_id, 7);
  assert.equal(progress.current_stage, 'PINNING');
  assert.deepEqual(calls, [[2], [7]]);
});

test('returns daily inspection history across all trays for an owned session', async () => {
  const { service, calls } = loadService();
  const history = await service.getDailyInspectionHistory(
    '7',
    { user_id: 7, role_id: 3 },
    { page: '2', pageSize: '10' },
  );

  assert.deepEqual(history.inspections, [{
    inspectionId: 3,
    trayId: 12,
    growthStage: 'PINNING',
    growthProgress: 40,
    trayCondition: 'Clean',
  }]);
  assert.deepEqual(history.pagination, { page: 2, pageSize: 10, total: 1, totalPages: 1 });
  assert.deepEqual(calls, [[7, { page: 2, pageSize: 10, limit: 10, offset: 10 }]]);
  await assert.rejects(
    () => service.getDailyInspectionHistory('8', { user_id: 7, role_id: 3 }),
    { statusCode: 404, message: 'Cultivation session not found' },
  );
});

test('returns daily inspection history for one tray assignment in a session', async () => {
  const { service, calls } = loadService();
  const history = await service.getTrayDailyInspectionHistory(
    '7',
    '14',
    { user_id: 7, role_id: 3 },
    { page: '1', pageSize: '5' },
  );

  assert.deepEqual(history.tray, { sessionTrayId: 14, trayId: 12, trayCode: 'TRAY-12' });
  assert.deepEqual(history.inspections, [{
    inspectionId: 3,
    growthStage: 'PINNING',
    growthProgress: 40,
    mushroomCondition: 'Healthy',
  }]);
  assert.deepEqual(history.pagination, { page: 1, pageSize: 5, total: 1, totalPages: 1 });
  assert.deepEqual(calls, [[7, 14, { page: 1, pageSize: 5, limit: 5, offset: 0 }]]);
  await assert.rejects(
    () => service.getTrayDailyInspectionHistory('7', '15', { user_id: 7, role_id: 3 }),
    { statusCode: 404, message: 'Session tray not found for this session' },
  );
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

test('growth validates observations and maps public statuses to existing stages', async () => {
  const { service, calls } = loadService();
  for (const [growthStatus, progressPercent, currentStage] of [
    ['FRUITING_INITIATION',10,'FRUITING_INITIATION'], ['PINNING',30,'PINNING'],
    ['YOUNG_FRUITING',60,'YOUNG_FRUITING'], ['MATURATION',90,'MATURATION'],
  ]) {
    await service.updateGrowthForAdmin('7', { growthStatus, progressPercent, condition: 'NORMAL', notes: 'Observed' });
    assert.deepEqual(calls.at(-1), [7, { currentStage, progressPercent, expectedHarvestDate: undefined, condition: 'NORMAL', notes: 'Observed' }]);
  }
  const valid = { growthStatus: 'PINNING', progressPercent: 65, condition: 'NORMAL' };
  for (const progressPercent of [undefined,null,'',true,-1,101,'bad',Infinity]) {
    await assert.rejects(() => service.updateGrowthForAdmin('7', { ...valid, progressPercent }), { statusCode: 400 });
  }
  for (const payload of [{ growthStatus: 'GROWING' }, { growthStatus: 'DEVELOPING' }, { growthStatus: 'NEAR_MATURE' }, { growthStatus: 'MATURE' }, { expectedHarvestDate: '2026-02-30' }, { expectedHarvestDate: 'bad' }, { growthStatus: 'INVALID' }, { growthStatus: null }, { condition: '' }, { condition: 3 }, { condition: 'x'.repeat(501) }, { notes: 'x'.repeat(1001) }]) {
    await assert.rejects(() => service.updateGrowthForAdmin('7', { ...valid, ...payload }), { statusCode: 400 });
  }
  await assert.rejects(() => service.assignTraysForAdmin('7', { trayIds: [10,11] }), { statusCode: 400 });
  assert.equal(calls.length, 4);
});

test('readiness requires an actual boolean and validates notes', async () => {
  const { service, calls } = loadService();
  for (const harvestReady of [true,false]) {
    await service.updateHarvestReadinessForAdmin('7', { harvestReady, notes: 'Assessment' }, '2');
    assert.deepEqual(calls.at(-1), [7, { harvestReady, confirmedBy: 2, notes: 'Assessment' }]);
  }
  for (const harvestReady of [undefined,null,'true',1]) {
    await assert.rejects(() => service.updateHarvestReadinessForAdmin('7', { harvestReady }), { statusCode: 400 });
  }
  await assert.rejects(() => service.updateHarvestReadinessForAdmin('7', { harvestReady: true, notes: 3 }), { statusCode: 400 });
  assert.equal(calls.length, 2);
});
