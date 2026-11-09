const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('session management allows operator inspections and restricts cancellation to admins', async () => {
  const userModelPath = require.resolve('../src/models/user.model');
  const controllerPath = require.resolve('../src/controllers/cultivationSession.controller');
  const authServicePath = require.resolve('../src/services/auth.service');
  const authMiddlewarePath = require.resolve('../src/middlewares/auth.middleware');
  const routePath = require.resolve('../src/routes/cultivationSession.routes');
  let cancelCalls = 0;
  let inspectionCalls = 0;
  let progressCalls = 0;
  let assignmentCalls = 0;
  let harvestReadyCalls = 0;
  let incidentCalls = 0;
  let incidentListCalls = 0;
  let availableTrayCalls = 0;
  let availableFloorId;
  let progressHistoryCalls = 0;
  let dailyInspectionHistoryCalls = 0;
  let trayDailyInspectionHistoryCalls = 0;
  let assignmentBody;
  const noop = (req, res) => res.sendStatus(204);

  require.cache[userModelPath] = {
    exports: {
      findById: async (userId) => ({ user_id: userId, role_id: Number(userId), status: 'ACTIVE' }),
    },
  };
  require.cache[controllerPath] = {
    exports: {
      adminList: (req, res) => res.json({ data: [], pagination: { page: 1 } }),
      adminGetById: (req, res) => res.json({ data: { session_id: req.params.sessionId } }),
      adminListAvailableTrays: (req, res) => {
        availableTrayCalls += 1;
        availableFloorId = req.query.floorId;
        res.sendStatus(204);
      },
      adminGetProgress: (req, res) => {
        progressHistoryCalls += 1;
        res.sendStatus(204);
      },
      getDailyInspectionHistory: (req, res) => {
        dailyInspectionHistoryCalls += 1;
        res.sendStatus(204);
      },
      getTrayDailyInspectionHistory: (req, res) => {
        trayDailyInspectionHistoryCalls += 1;
        res.sendStatus(204);
      },
      adminUpdateGrowth: (req, res) => { progressCalls += 1; res.sendStatus(204); },
      adminCreateInspection: (req, res) => {
        inspectionCalls += 1;
        res.sendStatus(204);
      },
      adminAddInspectionImage: noop,
      adminAssignTrays: (req, res) => {
        assignmentCalls += 1;
        assignmentBody = req.body;
        res.sendStatus(204);
      },
      adminActivate: (req, res) => {

        res.sendStatus(204);
      },
      adminUpdateHarvestReadiness: (req, res) => {
        harvestReadyCalls += 1;
        res.sendStatus(204);
      },
      adminCreateIncident: (req, res) => {
        incidentCalls += 1;
        res.sendStatus(204);
      },
      adminListIncidents: (req, res) => {
        incidentListCalls += 1;
        res.sendStatus(204);
      },
      adminCancel: (req, res) => {
        cancelCalls += 1;
        res.sendStatus(204);
      },
      adminCreateNotification: noop,
    },
  };
  require.cache[authServicePath] = { exports: { sanitizeUser: (user) => user } };
  delete require.cache[authMiddlewarePath];
  delete require.cache[routePath];

  const env = require('../src/config/env');
  const app = express();
  app.use(express.json());
  app.use('/api/cultivation-sessions', require('../src/routes/cultivationSession.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({
    message: error.message,
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    for (const role of [1, 2, 3]) {
      const headers = { authorization: `Bearer ${jwt.sign({ sub: String(role) }, env.jwtSecret)}` };
      const baseUrl = `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin`;
      const list = await fetch(baseUrl, { headers });
      const detail = await fetch(`${baseUrl}/77`, { headers });
      assert.equal(list.status, role === 3 ? 403 : 200);
      assert.equal(detail.status, role === 3 ? 403 : 200);
      if (role !== 3) {
        assert.deepEqual(await list.json(), { data: [], pagination: { page: 1 } });
        assert.deepEqual(await detail.json(), { data: { session_id: '77' } });
      }
    }
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin`)).status, 401);
    const operatorToken = jwt.sign({ sub: '2' }, env.jwtSecret);
    const inspectionResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/session-trays/14/inspections`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ growthStage: 'FRUITING_INITIATION', growthProgress: 60 }),
      },
    );
    assert.equal(inspectionResponse.status, 204);
    assert.equal(inspectionCalls, 1);

    const availableTraysResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/available-trays?floorId=2`,
      { headers: { authorization: `Bearer ${operatorToken}` } },
    );
    assert.equal(availableTraysResponse.status, 204);
    assert.equal(availableTrayCalls, 1);
    assert.equal(availableFloorId, '2');

    const progressHistoryResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/progress`,
      { headers: { authorization: `Bearer ${operatorToken}` } },
    );
    assert.equal(progressHistoryResponse.status, 204);
    assert.equal(progressHistoryCalls, 1);

    const iotHistoryUrl = `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/iot-history`;
    assert.equal((await fetch(iotHistoryUrl, {
      headers: { authorization: `Bearer ${operatorToken}` },
    })).status, 404);
    assert.equal((await fetch(`${iotHistoryUrl}/sensors`, {
      headers: { authorization: `Bearer ${operatorToken}` },
    })).status, 404);
    const dailyInspectionHistoryUrl = `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/77/daily-inspections`;
    assert.equal((await fetch(dailyInspectionHistoryUrl, {
      headers: { authorization: `Bearer ${customerToken}` },
    })).status, 204);
    assert.equal(dailyInspectionHistoryCalls, 1);
    const trayInspectionHistoryUrl = `${dailyInspectionHistoryUrl.replace('/daily-inspections', '/trays/14/daily-inspections')}?page=1&pageSize=10`;
    assert.equal((await fetch(trayInspectionHistoryUrl, {
      headers: { authorization: `Bearer ${customerToken}` },
    })).status, 204);
    assert.equal(trayDailyInspectionHistoryCalls, 1);

    const assignmentResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/trays`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ floorId: 2, trayIds: [10, 11] }),
      },
    );
    assert.equal(assignmentResponse.status, 204);
    assert.equal(assignmentCalls, 1);
    assert.deepEqual(assignmentBody, { floorId: 2, trayIds: [10, 11] });

    for (const [path, counter] of [['growth', () => progressCalls], ['harvest-readiness', () => harvestReadyCalls]]) {
      const url = `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/${path}`;
      assert.equal((await fetch(url, { method: 'PATCH' })).status, 401);
      const customerToken = jwt.sign({ sub: '3' }, env.jwtSecret);
      assert.equal((await fetch(url, { method: 'PATCH', headers: { authorization: `Bearer ${customerToken}` } })).status, 403);
      assert.equal((await fetch(url, { method: 'PATCH', headers: { authorization: `Bearer ${operatorToken}` } })).status, 204);
      assert.equal(counter(), 1);
    }
    for (const path of ['activate','progress','harvest-ready']) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/${path}`,
        { method: 'POST', headers: { authorization: `Bearer ${operatorToken}` } });
      assert.equal(response.status, 404);
    }

    const incidentResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/incidents`,
      { method: 'POST', headers: { authorization: `Bearer ${operatorToken}` } },
    );
    assert.equal(incidentResponse.status, 204);
    assert.equal(incidentCalls, 1);

    const incidentListResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/incidents`,
      { headers: { authorization: `Bearer ${operatorToken}` } },
    );
    assert.equal(incidentListResponse.status, 204);
    assert.equal(incidentListCalls, 1);

    const operatorCancelResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/cancel`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${operatorToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Customer request' }),
      },
    );
    assert.equal(operatorCancelResponse.status, 403);
    assert.equal(cancelCalls, 0);

    const adminToken = jwt.sign({ sub: '1' }, env.jwtSecret);
    const adminCancelResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/cancel`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Customer request' }),
      },
    );
    assert.equal(adminCancelResponse.status, 204);
    assert.equal(cancelCalls, 1);

    const removedHarvestCompletion = await fetch(
      `http://127.0.0.1:${server.address().port}/api/cultivation-sessions/admin/77/complete`,
      { method: 'POST' },
    );
    assert.equal(removedHarvestCompletion.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
