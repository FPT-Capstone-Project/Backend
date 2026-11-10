const cultivationSessionService = require('../services/cultivationSession.service');

async function adminList(req, res) {
  const result = await cultivationSessionService.getAllForAdmin(req.query || {});
  res.json({ data: result.sessions, pagination: result.pagination });
}

async function adminGetById(req, res) {
  const session = await cultivationSessionService.getByIdForAdmin(req.params.sessionId);
  res.json({ data: session });
}

async function adminListAvailableTrays(req, res) {
  const trays = await cultivationSessionService.getAvailableTraysForAdmin(req.query || {});
  res.json({ data: trays });
}

async function adminGetProgress(req, res) {
  const progress = await cultivationSessionService.getProgressForAdmin(req.params.sessionId);
  res.json({ data: progress });
}

async function getDailyInspectionHistory(req, res) {
  const history = await cultivationSessionService.getDailyInspectionHistory(
    req.params.sessionId,
    req.user,
    req.query || {},
  );
  res.json({ data: history });
}

async function getTrayDailyInspectionHistory(req, res) {
  const history = await cultivationSessionService.getTrayDailyInspectionHistory(
    req.params.sessionId,
    req.params.sessionTrayId,
    req.user,
    req.query || {},
  );
  res.json({ data: history });
}

async function adminAssignTrays(req, res) {
  const result = await cultivationSessionService.assignTraysForAdmin(
    req.params.sessionId,
    req.body || {},
  );
  res.status(201).json({ message: 'Cultivation trays assigned successfully', data: result });
}

async function adminUpdateGrowth(req, res) {
  const progress = await cultivationSessionService.updateGrowthForAdmin(
    req.params.sessionId,
    req.body || {},
  );
  res.json({ message: 'Cultivation growth updated successfully', data: progress });
}

async function adminUpdateHarvestReadiness(req, res) {
  const session = await cultivationSessionService.updateHarvestReadinessForAdmin(
    req.params.sessionId, req.body || {}, req.user.user_id,
  );
  res.json({ message: 'Cultivation harvest readiness updated successfully', data: session });
}

async function adminCreateInspection(req, res) {
  const result = await cultivationSessionService.createInspectionWithImagesForAdmin(
    req.params.sessionTrayId,
    req.body || {},
    req.user.user_id,
    req.files || [],
  );
  res.status(201).json({ message: 'Daily tray inspection recorded successfully', data: result });
}

async function adminAddInspectionImage(req, res) {
  const image = await cultivationSessionService.addInspectionImageForAdmin(
    req.params.inspectionId,
    req.file,
    req.body || {},
  );
  res.status(201).json({ message: 'Cultivation inspection image uploaded successfully', data: image });
}

async function adminCreateIncident(req, res) {
  const incident = await cultivationSessionService.createIncidentForAdmin(
    req.params.sessionId,
    req.body || {},
    req.user.user_id,
  );
  res.status(201).json({ message: 'Cultivation incident recorded successfully', data: incident });
}

async function adminListIncidents(req, res) {
  const incidents = await cultivationSessionService.listIncidentsForAdmin(req.params.sessionId);
  res.json({ data: incidents });
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
  adminListAvailableTrays,
  adminGetProgress,
  getDailyInspectionHistory,
  getTrayDailyInspectionHistory,
  adminAssignTrays,
  adminUpdateGrowth,
  adminUpdateHarvestReadiness,
  adminCreateInspection,
  adminAddInspectionImage,
  adminCreateIncident,
  adminListIncidents,
  adminCancel,
  adminCreateNotification,
};
