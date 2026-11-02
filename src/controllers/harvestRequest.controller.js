const harvestRequestService = require('../services/harvestRequest.service');

async function create(req, res) {
  const request = await harvestRequestService.createHarvestRequest(req.body || {}, req.user);
  res.status(201).json({ message: 'Harvest request created successfully', data: request });
}

async function update(req, res) {
  const request = await harvestRequestService.updateHarvestRequest(
    req.params.id,
    req.body || {},
    req.user,
  );
  res.json({ message: 'Harvest request updated successfully', data: request });
}

async function complete(req, res) {
  const request = await harvestRequestService.completeHarvestRequest(req.params.id, req.user);
  res.json({ message: 'Harvest receiving completed successfully', data: request });
}

module.exports = { create, update, complete };
