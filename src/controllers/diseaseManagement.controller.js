const diseaseService = require('../services/diseaseManagement.service');

async function createIssue(req, res) {
  const issue = await diseaseService.createIssue(req.user, req.body || {});
  res.status(201).json({ message: 'Issue created successfully', data: issue });
}

async function listIssues(req, res) {
  const result = await diseaseService.listIssues(req.user, req.query || {});
  res.json({ data: result.issues, pagination: result.pagination });
}

async function getIssue(req, res) {
  const issue = await diseaseService.getIssue(req.user, req.params.issueId);
  res.json({ data: issue });
}

async function changeIssueStatus(req, res) {
  const issue = await diseaseService.changeIssueStatus(
    req.user,
    req.params.issueId,
    req.body?.status,
  );
  res.json({ message: 'Issue status updated successfully', data: issue });
}

async function resolveIssue(req, res) {
  const issue = await diseaseService.resolveIssue(req.user, req.params.issueId);
  res.json({ message: 'Issue resolved successfully', data: issue });
}

async function addIssueMedia(req, res) {
  const media = await diseaseService.addIssueMedia(
    req.user,
    req.params.issueId,
    req.file,
    req.body || {},
  );
  res.status(201).json({ message: 'Issue media uploaded successfully', data: media });
}

async function createConsultation(req, res) {
  const consultation = await diseaseService.createConsultation(
    req.user,
    req.params.issueId,
    req.body || {},
  );
  res.status(201).json({ message: 'Expert consultation requested successfully', data: consultation });
}

async function addConsultationMessage(req, res) {
  const message = await diseaseService.addConsultationMessage(
    req.user,
    req.params.consultationId,
    req.body || {},
  );
  res.status(201).json({ message: 'Consultation information added successfully', data: message });
}

async function listConsultations(req, res) {
  const result = await diseaseService.listConsultations(req.user, req.query || {});
  res.json({ data: result.consultations, pagination: result.pagination });
}

async function getConsultation(req, res) {
  const consultation = await diseaseService.getConsultation(req.user, req.params.consultationId);
  res.json({ data: consultation });
}

async function assignConsultation(req, res) {
  const consultation = await diseaseService.assignConsultation(
    req.user,
    req.params.consultationId,
    req.body || {},
  );
  res.json({ message: 'Consultation assigned successfully', data: consultation });
}

async function respondToConsultation(req, res) {
  const consultation = await diseaseService.respondToConsultation(
    req.user,
    req.params.consultationId,
    req.body || {},
  );
  res.json({ message: 'Consultation response submitted successfully', data: consultation });
}

async function closeConsultation(req, res) {
  const consultation = await diseaseService.closeConsultation(req.user, req.params.consultationId);
  res.json({ message: 'Consultation closed successfully', data: consultation });
}

async function createTreatment(req, res) {
  const treatment = await diseaseService.createTreatment(
    req.user,
    req.params.consultationId,
    req.body || {},
  );
  res.status(201).json({ message: 'Treatment recorded successfully', data: treatment });
}

async function getTreatments(req, res) {
  const treatments = await diseaseService.getTreatments(req.user, req.params.consultationId);
  res.json({ data: treatments });
}

async function addTreatmentMedia(req, res) {
  const media = await diseaseService.addTreatmentMedia(
    req.user,
    req.params.treatmentLogId,
    req.file,
    req.body || {},
  );
  res.status(201).json({ message: 'Treatment media uploaded successfully', data: media });
}

async function deleteTreatmentMedia(req, res) {
  const result = await diseaseService.deleteTreatmentMedia(
    req.user,
    req.params.treatmentLogId,
    req.params.mediaId,
  );
  res.json({ message: 'Treatment media deleted successfully', data: result });
}

async function customerSessionIssues(req, res) {
  const issues = await diseaseService.customerIssues(req.user, req.params.sessionId);
  res.json({ data: issues });
}

async function customerIssue(req, res) {
  const issue = await diseaseService.customerIssue(req.user, req.params.issueId);
  res.json({ data: issue });
}

async function customerIssueTimeline(req, res) {
  const timeline = await diseaseService.customerIssue(req.user, req.params.issueId, true);
  res.json({ data: timeline });
}

module.exports = {
  createIssue,
  listIssues,
  getIssue,
  changeIssueStatus,
  resolveIssue,
  addIssueMedia,
  createConsultation,
  addConsultationMessage,
  listConsultations,
  getConsultation,
  assignConsultation,
  respondToConsultation,
  closeConsultation,
  createTreatment,
  getTreatments,
  addTreatmentMedia,
  deleteTreatmentMedia,
  customerSessionIssues,
  customerIssue,
  customerIssueTimeline,
};
