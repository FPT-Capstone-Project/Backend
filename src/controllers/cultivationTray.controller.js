const cultivationTrayService = require('../services/cultivationTray.service');

async function list(req, res) {
  res.json({ data: await cultivationTrayService.getAllCultivationTrays(req.query || {}) });
}

async function listByRoom(req, res) {
  const data = await cultivationTrayService.getCultivationTraysByRoomId(req.params.id, req.query || {});
  res.json({ data });
}

async function getById(req, res) {
  res.json({ data: await cultivationTrayService.getCultivationTrayById(req.params.id) });
}

async function create(req, res) {
  const tray = await cultivationTrayService.createCultivationTray(req.body || {});
  res.status(201).json({ message: 'Cultivation tray created successfully', data: tray });
}

async function update(req, res) {
  const tray = await cultivationTrayService.updateCultivationTray(req.params.id, req.body || {});
  res.json({ message: 'Cultivation tray updated successfully', data: tray });
}

async function remove(req, res) {
  const tray = await cultivationTrayService.deleteCultivationTray(req.params.id);
  res.json({ message: 'Cultivation tray deleted successfully', data: tray });
}

module.exports = { list, listByRoom, getById, create, update, remove };