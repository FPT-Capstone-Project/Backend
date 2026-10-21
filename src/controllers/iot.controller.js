const service = require('../services/iot.service');

module.exports = {
  configureLight: async (req, res) => res.json({ data: await service.configureLight(req.params.masterId, req.body) }),
  list: async (req, res) => res.json({ data: await service.listMasters() }),
  sensors: async (req, res) => res.json({ data: await service.sensors(req.params.masterId) }),
  sensor: async (req, res) => res.json({ data: await service.sensor(req.params.masterId, req.params.nodeId, req.params.sensorId) }),
  history: async (req, res) => res.json({ data: await service.history(req.params.masterId, req.params.nodeId, req.params.sensorId, req.query) }),
  ssr: async (req, res) => res.json({ data: await service.ssr(req.params.masterId) }),
  command: async (req, res) => res.json({ data: await service.command(req.params.commandId) }),
  control: async (req, res) => res.status(202).json({ data: await service.control(req.params.masterId, req.params.channel, req.body, req.user.user_id) }),
};
