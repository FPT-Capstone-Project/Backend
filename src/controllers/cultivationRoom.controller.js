const cultivationRoomService = require('../services/cultivationRoom.service');

async function list(req, res) {
  res.json({ data: await cultivationRoomService.getAllCultivationRooms(req.query || {}) });
}

async function getById(req, res) {
  res.json({ data: await cultivationRoomService.getCultivationRoomById(req.params.id) });
}

async function create(req, res) {
  const room = await cultivationRoomService.createCultivationRoom(req.body || {});
  res.status(201).json({ message: 'Cultivation room created successfully', data: room });
}

async function update(req, res) {
  const room = await cultivationRoomService.updateCultivationRoom(req.params.id, req.body || {});
  res.json({ message: 'Cultivation room updated successfully', data: room });
}

async function remove(req, res) {
  const room = await cultivationRoomService.deleteCultivationRoom(req.params.id);
  res.json({ message: 'Cultivation room deleted successfully', data: room });
}

module.exports = { list, getById, create, update, remove };