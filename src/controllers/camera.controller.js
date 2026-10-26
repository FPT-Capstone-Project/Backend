const cameraService = require('../services/camera.service');

async function list(req, res) {
  res.json({ data: await cameraService.getAllCameras(req.query || {}) });
}

async function getById(req, res) {
  res.json({ data: await cameraService.getCameraById(req.params.cameraId) });
}

async function create(req, res) {
  const camera = await cameraService.createCamera(req.body || {});
  res.status(201).json({ message: 'Camera created successfully', data: camera });
}

async function update(req, res) {
  const camera = await cameraService.updateCamera(req.params.cameraId, req.body || {});
  res.json({ message: 'Camera updated successfully', data: camera });
}

async function remove(req, res) {
  const camera = await cameraService.deleteCamera(req.params.cameraId);
  res.json({ message: 'Camera deleted successfully', data: camera });
}

async function getLiveStream(req, res) {
  const cameraId = Number(req.params.cameraId);
  if (!Number.isSafeInteger(cameraId) || cameraId < 1) {
    return res.status(400).json({ message: 'Invalid camera ID' });
  }

  const channelId = req.query.channelId === undefined ? '0' : String(req.query.channelId);
  if (!/^\d{1,3}$/.test(channelId)) {
    return res.status(400).json({ message: 'channelId must be a number from 0 to 999' });
  }

  const streamIdValue = req.query.streamId === undefined ? '0' : req.query.streamId;
  if (typeof streamIdValue !== 'string' || !['0', '1'].includes(streamIdValue)) {
    return res.status(400).json({ message: 'streamId must be 0 or 1' });
  }
  const streamId = Number(streamIdValue);

  const data = await cameraService.getLiveStream(cameraId, channelId, streamId);
  return res.json({ data });
}

async function getImouPlayerToken(req, res) {
  const cameraId = Number(req.params.cameraId);
  if (!Number.isSafeInteger(cameraId) || cameraId < 1) {
    return res.status(400).json({ message: 'Invalid camera ID' });
  }

  const channelId = req.query.channelId === undefined ? '0' : String(req.query.channelId);
  if (!/^\d{1,3}$/.test(channelId)) {
    return res.status(400).json({ message: 'channelId must be a number from 0 to 999' });
  }

  const streamIdValue = req.query.streamId === undefined ? '0' : req.query.streamId;
  if (typeof streamIdValue !== 'string' || !['0', '1'].includes(streamIdValue)) {
    return res.status(400).json({ message: 'streamId must be 0 or 1' });
  }

  const data = await cameraService.getImouPlayerToken(
    cameraId,
    channelId,
    Number(streamIdValue),
  );
  return res.json({ data });
}

async function listLiveStreams(req, res) {
  const start = req.query.start === undefined ? 1 : Number(req.query.start);
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
  if (!Number.isSafeInteger(start) || start < 1) {
    return res.status(400).json({ message: 'start must be a positive integer' });
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    return res.status(400).json({ message: 'limit must be an integer from 1 to 50' });
  }

  const data = await cameraService.getLiveStreams({ start, limit });
  return res.json({ data });
}

async function stopLiveStream(req, res) {
  const cameraId = Number(req.params.cameraId);
  if (!Number.isSafeInteger(cameraId) || cameraId < 1) {
    return res.status(400).json({ message: 'Invalid camera ID' });
  }
  const channelId = req.query.channelId === undefined ? '0' : String(req.query.channelId);
  if (!/^\d{1,3}$/.test(channelId)) {
    return res.status(400).json({ message: 'channelId must be a number from 0 to 999' });
  }

  const data = await cameraService.stopLiveStream(cameraId, channelId);
  return res.json({ data });
}

async function stopLiveSession(req, res) {
  const liveToken = req.body && req.body.liveToken;
  if (typeof liveToken !== 'string' || !liveToken.trim()) {
    return res.status(400).json({ message: 'liveToken is required' });
  }
  const data = await cameraService.stopLiveSession(liveToken);
  return res.json({ message: 'Live session stopped successfully', data });
}

module.exports = {
  list,
  getById,
  create,
  update,
  remove,
  getLiveStream,
  getImouPlayerToken,
  listLiveStreams,
  stopLiveStream,
  stopLiveSession,
};
