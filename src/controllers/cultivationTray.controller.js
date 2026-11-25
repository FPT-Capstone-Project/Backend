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

async function getQrImage(req, res) {
  const image = await cultivationTrayService.getCultivationTrayQrImage(req.params.id);
  res.type('png').set('Cache-Control', 'private, no-store').send(image);
}

async function generateMissingQrTokens(req, res) {
  const data = await cultivationTrayService.generateMissingQrTokens(req.user);
  res.json({ message: 'QR tokens generated for trays that were missing them', data });
}

async function scanQr(req, res) {
  const qrToken = req.body?.qrToken ?? req.body?.qr_token;
  res.json({ data: await cultivationTrayService.getCultivationTrayByQrToken(qrToken) });
}

async function update(req, res) {
  const tray = await cultivationTrayService.updateCultivationTray(req.params.id, req.body || {});
  res.json({ message: 'Cultivation tray updated successfully', data: tray });
}

async function remove(req, res) {
  const tray = await cultivationTrayService.deleteCultivationTray(req.params.id);
  res.json({ message: 'Cultivation tray deleted successfully', data: tray });
}

async function completeSanitation(req, res) {
  const tray = await cultivationTrayService.completeSanitation(req.params.id, req.user);
  res.json({ message: 'Đã xác nhận vệ sinh xong. Khay đã sẵn sàng sử dụng.', data: tray });
}

module.exports = {
  list,
  listByRoom,
  getById,
  create,
  getQrImage,
  generateMissingQrTokens,
  scanQr,
  update,
  remove,
  completeSanitation,
};
