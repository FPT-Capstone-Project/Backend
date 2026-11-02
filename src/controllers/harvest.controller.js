const harvestService = require('../services/harvest.service');

async function create(req, res) {
  const harvest = await harvestService.createHarvest(req.body || {});
  res.status(201).json({ message: 'Harvest created successfully', data: harvest });
}

async function start(req, res) {
  const harvest = await harvestService.startHarvest(req.params.id, req.user.user_id);
  res.json({ message: 'Harvest started successfully', data: harvest });
}

async function recordYield(req, res) {
  const harvest = await harvestService.recordYield(req.params.id, req.body || {}, req.user.user_id);
  res.json({ message: 'Harvest yield recorded successfully', data: harvest });
}

async function complete(req, res) {
  const harvest = await harvestService.completeHarvest(req.params.id, req.user.user_id);
  res.json({ message: 'Harvest completed successfully', data: harvest });
}

async function getById(req, res) {
  const harvest = await harvestService.getHarvest(req.params.id);
  res.json({ data: harvest });
}

async function adminList(req, res) {
  const result = await harvestService.listHarvests(req.query || {});
  res.json({ data: result.harvests, total: result.total });
}

module.exports = { create, start, recordYield, complete, getById, adminList };
