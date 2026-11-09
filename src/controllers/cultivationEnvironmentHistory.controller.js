const service = require('../services/cultivationEnvironmentHistory.service');

async function sessionHistory(req, res) {
  res.json(await service.getSessionHistory(req.params.sessionId, req.user, req.query || {}));
}

async function latestSessionHistory(req, res) {
  res.json({ data: await service.getLatestSessionHistory(req.params.sessionId, req.user) });
}

async function floorHistory(req, res) {
  res.json(await service.getFloorHistory(req.params.floorId, req.user, req.query || {}));
}

module.exports = { sessionHistory, latestSessionHistory, floorHistory };
