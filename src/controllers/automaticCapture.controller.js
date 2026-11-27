const service = require('../services/automaticCapture.service');

async function listConfigs(req, res) {
  res.json({ data: await service.getConfigs() });
}

async function getConfig(req, res) {
  res.json({ data: await service.getConfig(req.params.cameraId) });
}

async function updateConfig(req, res) {
  const config = await service.updateConfig(req.params.cameraId, req.body || {});
  res.json({ message: 'Automatic capture configuration updated successfully', data: config });
}

async function listLogs(req, res) {
  res.json(await service.getLogs(req.query || {}));
}

async function getLog(req, res) {
  res.json({ data: await service.getLog(req.params.logId) });
}

async function getCameraTrays(req, res) {
  res.json({ data: await service.getCameraTrays(req.params.cameraId) });
}

async function testCapture(req, res) {
  res.json(await service.testCapture(req.body?.cameraId, req.user.user_id));
}

module.exports = {
  listConfigs,
  getConfig,
  updateConfig,
  listLogs,
  getLog,
  getCameraTrays,
  testCapture,
};
