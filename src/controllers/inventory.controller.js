const service = require('../services/inventory.service');

module.exports = {
  async list(req, res) { res.json(await service.list(req.query)); },
  async exports(req, res) { res.json(await service.exports(req.query)); },
  async create(req, res) { res.status(201).json({ message: 'Inventory created successfully', data: await service.create(req.body) }); },
  async update(req, res) { res.json({ message: 'Inventory updated successfully', data: await service.update(req.params.inventoryId, req.body) }); },
  async remove(req, res) { res.json({ message: 'Inventory deleted successfully', data: await service.remove(req.params.inventoryId) }); },
};
