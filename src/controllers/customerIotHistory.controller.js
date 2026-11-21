const customerIotHistoryService = require('../services/customerIotHistory.service');

async function deviceHistory(req, res) {
  const result = await customerIotHistoryService.getDeviceHistory(
    req.params.sessionId,
    req.user,
    req.query || {},
  );
  res.json({ data: result });
}

async function sensorHistory(req, res) {
  const result = await customerIotHistoryService.getSensorHistory(
    req.params.sessionId,
    req.user,
    req.query || {},
  );
  res.json({ data: result });
}

async function currentSensorReadings(req, res) {
  const result = await customerIotHistoryService.getCurrentSensorReadings(
    req.params.sessionId,
    req.user,
  );
  res.json({ data: result });
}

module.exports = { deviceHistory, sensorHistory, currentSensorReadings };
