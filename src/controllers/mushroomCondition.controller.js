const mushroomConditionService = require('../services/mushroomCondition.service');

async function list(req, res) {
  const conditions = await mushroomConditionService.getAllMushroomConditions(req.query || {});
  res.json({ data: conditions });
}

async function getById(req, res) {
  const condition = await mushroomConditionService.getMushroomConditionById(req.params.id);
  res.json({ data: condition });
}

async function create(req, res) {
  const condition = await mushroomConditionService.createMushroomCondition(req.body || {});
  res.status(201).json({
    message: 'Mushroom condition created successfully',
    data: condition,
  });
}

async function update(req, res) {
  const condition = await mushroomConditionService.updateMushroomCondition(req.params.id, req.body || {});
  res.json({
    message: 'Mushroom condition updated successfully',
    data: condition,
  });
}

async function remove(req, res) {
  const condition = await mushroomConditionService.deleteMushroomCondition(req.params.id);
  res.json({
    message: 'Mushroom condition deleted successfully',
    data: condition,
  });
}

module.exports = { list, getById, create, update, remove };
