const service = require('../services/complaint.service');

module.exports = {
  async create(req, res) { res.status(201).json({ data: await service.create(req.params.orderId, req.body || {}, req.files || [], req.user) }); },
  async list(req, res) { res.json(await service.list(req.query, req.user, false)); },
  async my(req, res) { res.json(await service.list(req.query, req.user, true)); },
  async detail(req, res) { res.json({ data: await service.detail(req.params.complaintId, req.user) }); },
  async reply(req, res) { res.status(201).json({ data: await service.reply(req.params.complaintId, req.body || {}, req.user) }); },
  async update(req, res) { res.json({ data: await service.update(req.params.complaintId, req.body || {}, req.user) }); },
  async assign(req, res) { res.json({ data: await service.update(req.params.complaintId, { assignedTo: req.body?.assignedTo !== undefined ? req.body.assignedTo : req.body?.assigned_to }, req.user) }); },
  async status(req, res) { res.json({ data: await service.update(req.params.complaintId, { status: req.body?.status, resolution: req.body?.resolution }, req.user) }); },
};
