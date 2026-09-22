const mushroomTypeService = require('../services/mushroomType.service');

async function list(req, res) {
  const mushroomTypes = await mushroomTypeService.getAllMushroomTypes(req.query || {});
  res.json({ data: mushroomTypes });
}

async function getById(req, res) {
  const mushroomType = await mushroomTypeService.getMushroomTypeById(req.params.id);
  res.json({ data: mushroomType });
}

async function create(req, res) {
  const payload = {
    ...(req.body || {}),
    imageFile: req.file || null,
  };

  const mushroomType = await mushroomTypeService.createMushroomType(payload);
  res.status(201).json({
    message: 'Mushroom type created successfully',
    data: mushroomType,
  });
}

async function update(req, res) {
  const payload = {
    ...(req.body || {}),
    imageFile: req.file || null,
  };

  const mushroomType = await mushroomTypeService.updateMushroomType(req.params.id, payload);
  res.json({
    message: 'Mushroom type updated successfully',
    data: mushroomType,
  });
}

async function remove(req, res) {
  const mushroomType = await mushroomTypeService.deleteMushroomType(req.params.id);
  res.json({
    message: 'Mushroom type deleted successfully',
    data: mushroomType,
  });
}

module.exports = { list, getById, create, update, remove };
