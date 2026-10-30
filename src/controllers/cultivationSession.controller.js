const cultivationSessionService = require('../services/cultivationSession.service');

async function adminList(req, res) {
  const result = await cultivationSessionService.getAllForAdmin(req.query || {});
  res.json({ data: result.sessions, pagination: result.pagination });
}

async function adminGetById(req, res) {
  const session = await cultivationSessionService.getByIdForAdmin(req.params.sessionId);
  res.json({ data: session });
}

async function adminCreateProgress(req, res) {
  const progress = await cultivationSessionService.createProgressForAdmin(
    req.params.sessionId,
    req.body || {},
  );
  res.status(201).json({ message: 'Cultivation progress recorded successfully', data: progress });
}

async function adminCreateInspection(req, res) {
  const result = await cultivationSessionService.createInspectionForAdmin(
    req.params.sessionTrayId,
    req.body || {},
    req.user.user_id,
  );
  res.status(201).json({ message: 'Daily tray inspection recorded successfully', data: result });
}

async function adminCreateHarvest(req, res) {
  const harvest = await cultivationSessionService.createHarvestForAdmin(
    req.params.sessionTrayId,
    req.body || {},
    req.user.user_id,
  );
  res.status(201).json({ message: 'Harvest recorded successfully', data: harvest });
}

async function adminComplete(req, res) {
  const result = await cultivationSessionService.completeForAdmin(
    req.params.sessionId,
    req.body || {},
  );
  res.json({ message: 'Cultivation session completed successfully', data: result });
}

async function adminCancel(req, res) {
  const result = await cultivationSessionService.cancelForAdmin(
    req.params.sessionId,
    req.body || {},
  );
  res.json({ message: 'Cultivation session cancelled successfully', data: result });
}

async function adminCreateNotification(req, res) {
  const notification = await cultivationSessionService.sendSessionNotification(
    req.params.sessionId,
    req.body || {},
    req.user.user_id,
  );
  res.status(201).json({ message: 'Notification sent', data: notification });
}

module.exports = {
  adminList,
  adminGetById,
  adminCreateProgress,
  adminCreateInspection,
  adminCreateHarvest,
  adminComplete,
  adminCancel,
  adminCreateNotification,
};
