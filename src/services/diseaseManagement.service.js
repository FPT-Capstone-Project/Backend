const diseaseModel = require('../models/diseaseManagement.model');
const cloudinaryService = require('./cloudinary.service');
const AppError = require('../utils/app-error');

const ISSUE_STATUSES = [
  'OPEN',
  'WAITING_EXPERT',
  'IN_PROGRESS',
  'MONITORING',
  'RESOLVED',
];
const CONSULTATION_STATUSES = ['PENDING', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'];
const MEDIA_STAGES = ['BEFORE', 'DURING', 'AFTER'];
const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function parseId(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new AppError(`${field} must be a positive integer`, 400);
  }
  return parsed;
}

function parseText(value, field, { required = false, maxLength = 5000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new AppError(`${field} is required`, 400);
    return undefined;
  }
  if (typeof value !== 'string') throw new AppError(`${field} must be a string`, 400);
  const text = value.trim();
  if (required && !text) throw new AppError(`${field} is required`, 400);
  if (text.length > maxLength) throw new AppError(`${field} must be at most ${maxLength} characters`, 400);
  return text;
}

function parseOptionalEnum(value, field, allowed) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = parseText(value, field, { required: true, maxLength: 50 }).toUpperCase();
  if (!allowed.includes(parsed)) {
    throw new AppError(`${field} must be one of: ${allowed.join(', ')}`, 400);
  }
  return parsed;
}

function parsePage(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? PAGE_SIZE : Number(query.pageSize);
  if (!Number.isInteger(page) || page < 1) throw new AppError('page must be a positive integer', 400);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new AppError(`pageSize must be between 1 and ${MAX_PAGE_SIZE}`, 400);
  }
  return { page, pageSize, limit: pageSize, offset: (page - 1) * pageSize };
}

function parseTimestamp(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new AppError(`${field} must be a valid ISO timestamp`, 400);
  }
  return new Date(value).toISOString();
}

async function getActor(user) {
  const userId = parseId(user?.user_id, 'userId');
  const roleName = await diseaseModel.getRole(userId);
  if (!roleName) throw new AppError('User role not found or account is inactive', 403);
  return { userId, roleId: Number(user.role_id), roleName };
}

function isAdmin(actorInfo) {
  return actorInfo.roleId === 1;
}

function isFarmOperator(actorInfo) {
  return actorInfo.roleId === 2;
}

function isExpert(actorInfo) {
  return diseaseModel.isExpertRole(actorInfo.roleName);
}

function requireFarmOperator(actorInfo) {
  if (!isAdmin(actorInfo) && !isFarmOperator(actorInfo)) {
    throw new AppError('Farm Operator role is required', 403);
  }
}

function requireExpert(actorInfo) {
  if (!isAdmin(actorInfo) && !isExpert(actorInfo)) {
    throw new AppError('Mushroom Expert role is required', 403);
  }
}

function requireStaff(actorInfo) {
  if (!isAdmin(actorInfo) && !isFarmOperator(actorInfo) && !isExpert(actorInfo)) {
    throw new AppError('Staff access is required', 403);
  }
}

function requireCustomer(actorInfo) {
  if (!isAdmin(actorInfo) && actorInfo.roleId !== 3) {
    throw new AppError('Customer role is required', 403);
  }
}

async function createIssue(user, payload = {}) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const sessionTrayId = payload.sessionTrayId ?? payload.session_tray_id;
  const spawnInspectionId = payload.spawnInspectionId ?? payload.spawn_inspection_id;
  const inspectionId = payload.inspectionId ?? payload.inspection_id;
  if ((sessionTrayId === undefined) === (spawnInspectionId === undefined)) {
    throw new AppError('Provide exactly one of sessionTrayId or spawnInspectionId', 400);
  }
  if (inspectionId !== undefined && sessionTrayId === undefined) {
    throw new AppError('inspectionId can only be used with a tray issue', 400);
  }

  const issueType = parseText(payload.issueType ?? payload.issue_type, 'issueType', {
    required: true,
    maxLength: 100,
  }).toUpperCase();
  const title = parseText(payload.title, 'title', { required: true, maxLength: 255 });
  const description = parseText(payload.description, 'description', { required: true });
  const severity = parseOptionalEnum(payload.severity, 'severity', SEVERITIES);
  return diseaseModel.createIssue({
    sessionTrayId: sessionTrayId === undefined ? undefined : parseId(sessionTrayId, 'sessionTrayId'),
    inspectionId: inspectionId === undefined ? undefined : parseId(inspectionId, 'inspectionId'),
    spawnInspectionId: spawnInspectionId === undefined
      ? undefined
      : parseId(spawnInspectionId, 'spawnInspectionId'),
    issueType,
    title,
    description,
    severity,
  }, actorInfo.userId);
}

async function listIssues(user, query = {}) {
  const actorInfo = await getActor(user);
  requireStaff(actorInfo);
  const pagination = parsePage(query);
  const result = await diseaseModel.findIssues({
    status: parseOptionalEnum(query.status, 'status', ISSUE_STATUSES),
    severity: parseOptionalEnum(query.severity, 'severity', SEVERITIES),
    sessionId: query.sessionId === undefined || query.sessionId === ''
      ? undefined
      : parseId(query.sessionId, 'sessionId'),
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return {
    ...result,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pagination.pageSize),
    },
  };
}

async function getIssue(user, issueId) {
  const actorInfo = await getActor(user);
  requireStaff(actorInfo);
  const id = parseId(issueId, 'issueId');
  const issue = await diseaseModel.findIssue(id);
  if (!issue) throw new AppError('Issue not found', 404);
  issue.media = await diseaseModel.findIssueMedia(id);
  return issue;
}

const operatorTransitions = {
  OPEN: ['IN_PROGRESS'],
  WAITING_EXPERT: [],
  IN_PROGRESS: ['MONITORING'],
  MONITORING: [],
};

async function changeIssueStatus(user, issueId, value) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const nextStatus = parseOptionalEnum(value, 'status', ISSUE_STATUSES);
  if (!nextStatus) throw new AppError('status is required', 400);
  const id = parseId(issueId, 'issueId');
  const issue = await diseaseModel.findIssue(id);
  if (!issue) throw new AppError('Issue not found', 404);
  const allowed = operatorTransitions[issue.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new AppError(`Cannot change issue from ${issue.status} to ${nextStatus}`, 409);
  }
  if (nextStatus === 'MONITORING' && !await diseaseModel.hasTreatmentResult(id)) {
    throw new AppError('Record a treatment result before submitting the issue for review', 409);
  }
  return diseaseModel.updateIssueStatus(id, nextStatus, issue.status);
}

async function resolveIssue(user, issueId) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  const id = parseId(issueId, 'issueId');
  const issue = await diseaseModel.findIssue(id);
  if (!issue) throw new AppError('Issue not found', 404);
  if (issue.status !== 'MONITORING') {
    throw new AppError('Only issues pending expert review can be resolved', 409);
  }
  if (!isAdmin(actorInfo) && Number(issue.assigned_expert_id) !== actorInfo.userId) {
    throw new AppError('Only the assigned expert can resolve this issue', 403);
  }
  return diseaseModel.updateIssueStatus(id, 'RESOLVED', issue.status);
}

async function addIssueMedia(user, issueId, file, payload = {}) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const id = parseId(issueId, 'issueId');
  if (!file) throw new AppError('Media file is required', 400);
  const issue = await diseaseModel.findIssue(id);
  if (!issue) throw new AppError('Issue not found', 404);
  if (['MONITORING', 'RESOLVED'].includes(issue.status)) {
    throw new AppError('Issue evidence is locked in its current state', 409);
  }
  if (issue.spawn_inspection_id === null && issue.inspection_id === null) {
    throw new AppError('Issue images require a linked inspection in the supplied database', 409);
  }
  if (!file.mimetype?.startsWith('image/')) {
    throw new AppError('The supplied database only supports issue images', 400);
  }
  const caption = parseText(payload.caption, 'caption', { maxLength: 500 });
  const media = await cloudinaryService.uploadMedia(file, 'mushroom-disease/issues');
  try {
    return await diseaseModel.createIssueMedia(id, media, actorInfo.userId, caption);
  } catch (error) {
    try {
      await cloudinaryService.deleteMedia(media.publicId, media.resourceType);
    } catch (cleanupError) {
      console.error('Unable to remove orphaned issue media from Cloudinary:', cleanupError);
    }
    throw error;
  }
}

async function createConsultation(user, issueId, payload = {}) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const id = parseId(issueId, 'issueId');
  const issue = await diseaseModel.findIssue(id);
  if (!issue) throw new AppError('Issue not found', 404);
  return diseaseModel.createConsultation(
    id,
    parseText(payload.question, 'question', { required: true }),
    actorInfo.userId,
  );
}

async function addConsultationMessage(user, consultationId, payload = {}) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  return diseaseModel.createConsultationMessage(
    parseId(consultationId, 'consultationId'),
    parseText(payload.message, 'message', { required: true }),
    actorInfo.userId,
  );
}

async function listConsultations(user, query = {}) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  const pagination = parsePage(query);
  const result = await diseaseModel.findConsultations({
    status: parseOptionalEnum(query.status, 'status', CONSULTATION_STATUSES),
    limit: pagination.limit,
    offset: pagination.offset,
  });
  return {
    ...result,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / pagination.pageSize),
    },
  };
}

async function getConsultation(user, consultationId) {
  const actorInfo = await getActor(user);
  requireStaff(actorInfo);
  const id = parseId(consultationId, 'consultationId');
  const consultation = await diseaseModel.findConsultation(id);
  if (!consultation) throw new AppError('Consultation not found', 404);
  if (isExpert(actorInfo) && !isAdmin(actorInfo)
    && consultation.expert_id !== null
    && Number(consultation.expert_id) !== actorInfo.userId) {
    throw new AppError('Consultation is assigned to another expert', 403);
  }
  consultation.treatments = await diseaseModel.findTreatments(id);
  consultation.messages = await diseaseModel.findConsultationMessages(id);
  return consultation;
}

async function assignConsultation(user, consultationId, payload = {}) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  const id = parseId(consultationId, 'consultationId');
  const consultation = await diseaseModel.findConsultation(id);
  if (!consultation) throw new AppError('Consultation not found', 404);
  if (!isAdmin(actorInfo)
    && consultation.expert_id !== null
    && Number(consultation.expert_id) !== actorInfo.userId) {
    throw new AppError('Consultation is assigned to another expert', 403);
  }
  const targetExpertId = isAdmin(actorInfo)
    ? parseId(payload.expertId ?? payload.expert_id, 'expertId')
    : actorInfo.userId;
  const targetRole = await diseaseModel.getRole(targetExpertId);
  if (!targetRole || !diseaseModel.isExpertRole(targetRole)) {
    throw new AppError('The selected user is not an active Mushroom Expert', 400);
  }
  return diseaseModel.assignConsultation(id, targetExpertId);
}

async function respondToConsultation(user, consultationId, payload = {}) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  const id = parseId(consultationId, 'consultationId');
  const consultation = await diseaseModel.findConsultation(id);
  if (!consultation) throw new AppError('Consultation not found', 404);
  if (!isAdmin(actorInfo) && Number(consultation.expert_id) !== actorInfo.userId) {
    throw new AppError('Only the assigned expert can respond', 403);
  }
  const needsMoreInfo = payload.needsMoreInfo === true || payload.needs_more_info === true;
  const rawNeedsMoreInfo = payload.needsMoreInfo ?? payload.needs_more_info;
  if (rawNeedsMoreInfo !== undefined && typeof rawNeedsMoreInfo !== 'boolean') {
    throw new AppError('needsMoreInfo must be a boolean', 400);
  }
  const rawStatus = payload.status === undefined ? undefined : String(payload.status).toUpperCase();
  if (rawStatus !== undefined && !['NEED_MORE_INFO', 'ANSWERED'].includes(rawStatus)) {
    throw new AppError('status must be NEED_MORE_INFO or ANSWERED', 400);
  }
  const requestedMoreInfo = rawStatus === 'NEED_MORE_INFO' || needsMoreInfo;
  return diseaseModel.respondToConsultation(id, {
    diagnosis: parseText(payload.diagnosis, 'diagnosis', { required: true }),
    solution: requestedMoreInfo
      ? parseText(payload.solution, 'solution')
      : parseText(payload.solution, 'solution', { required: true }),
    needsMoreInfo: requestedMoreInfo,
  }, actorInfo.userId);
}

async function closeConsultation(user, consultationId) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  const id = parseId(consultationId, 'consultationId');
  const consultation = await diseaseModel.findConsultation(id);
  if (!consultation) throw new AppError('Consultation not found', 404);
  if (!isAdmin(actorInfo) && Number(consultation.expert_id) !== actorInfo.userId) {
    throw new AppError('Only the assigned expert can close this consultation', 403);
  }
  return diseaseModel.closeConsultation(id);
}

async function createTreatment(user, consultationId, payload = {}) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const id = parseId(consultationId, 'consultationId');
  const performedAt = parseTimestamp(payload.performedAt ?? payload.performed_at, 'performedAt');
  if (performedAt && new Date(performedAt) > new Date()) {
    throw new AppError('performedAt cannot be in the future', 400);
  }
  const treatment = await diseaseModel.createTreatment(id, {
    actionDescription: parseText(
      payload.actionDescription ?? payload.action_description,
      'actionDescription',
      { required: true },
    ),
    resultDescription: parseText(
      payload.resultDescription ?? payload.result_description,
      'resultDescription',
    ),
    performedAt,
  }, actorInfo.userId);
  return treatment;
}

async function getTreatments(user, consultationId) {
  const actorInfo = await getActor(user);
  requireStaff(actorInfo);
  const id = parseId(consultationId, 'consultationId');
  const consultation = await diseaseModel.findConsultation(id);
  if (!consultation) throw new AppError('Consultation not found', 404);
  return diseaseModel.findTreatments(id);
}

async function addTreatmentMedia(user, treatmentLogId, file, payload = {}) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const id = parseId(treatmentLogId, 'treatmentLogId');
  if (!file) throw new AppError('Media file is required', 400);
  const treatment = await diseaseModel.findTreatment(id);
  if (!treatment) throw new AppError('Treatment log not found', 404);
  if (Number(treatment.performed_by) !== actorInfo.userId && !isAdmin(actorInfo)) {
    throw new AppError('Only the treatment author or an admin can upload media', 403);
  }
  if (['MONITORING', 'RESOLVED'].includes(treatment.issue_status)) {
    throw new AppError('Treatment media is locked in its current state', 409);
  }
  const mediaStage = parseOptionalEnum(payload.mediaStage ?? payload.media_stage, 'mediaStage', MEDIA_STAGES);
  if (!mediaStage) throw new AppError('mediaStage is required', 400);
  const caption = parseText(payload.caption, 'caption', { maxLength: 500 });
  const media = await cloudinaryService.uploadMedia(file, 'mushroom-disease/treatments');
  try {
    return await diseaseModel.createTreatmentMedia(
      id,
      media,
      actorInfo.userId,
      mediaStage,
      caption,
    );
  } catch (error) {
    try {
      await cloudinaryService.deleteMedia(media.publicId, media.resourceType);
    } catch (cleanupError) {
      console.error('Unable to remove orphaned treatment media from Cloudinary:', cleanupError);
    }
    throw error;
  }
}

async function deleteTreatmentMedia(user, treatmentLogId, mediaId) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const id = parseId(mediaId, 'mediaId');
  const treatment = await diseaseModel.findTreatment(parseId(treatmentLogId, 'treatmentLogId'));
  if (!treatment) throw new AppError('Treatment log not found', 404);
  const media = await diseaseModel.findTreatmentMedia(id);
  if (!media || Number(media.treatment_log_id) !== Number(treatment.treatment_log_id)) {
    throw new AppError('Treatment media not found', 404);
  }
  if (Number(media.performed_by) !== actorInfo.userId && !isAdmin(actorInfo)) {
    throw new AppError('Only the treatment author or an admin can delete this media', 403);
  }
  if (['MONITORING', 'RESOLVED'].includes(media.issue_status)) {
    throw new AppError('Treatment media is locked in its current state', 409);
  }
  const resourceType = media.media_type === 'VIDEO' ? 'video' : 'image';
  const publicId = cloudinaryService.getPublicIdFromUrl(media.media_url);
  if (!publicId) {
    throw new AppError('Media URL does not contain a valid Cloudinary reference', 409);
  }
  await cloudinaryService.deleteMedia(publicId, resourceType);
  await diseaseModel.deleteTreatmentMedia(id);
  return { mediaId: id, deleted: true };
}

async function customerIssues(user, sessionId) {
  const actorInfo = await getActor(user);
  requireCustomer(actorInfo);
  const id = parseId(sessionId, 'sessionId');
  if (isAdmin(actorInfo)) {
    return diseaseModel.findSessionIssuesForAdmin(id);
  }
  if (!await diseaseModel.customerOwnsSession(id, actorInfo.userId)) {
    throw new AppError('Cultivation session not found', 404);
  }
  return diseaseModel.findCustomerIssues(id, actorInfo.userId);
}

async function customerIssue(user, issueId, includeTimeline = false) {
  const actorInfo = await getActor(user);
  requireCustomer(actorInfo);
  const id = parseId(issueId, 'issueId');
  if (isAdmin(actorInfo)) {
    const timeline = await diseaseModel.findIssueTimeline(id);
    if (!timeline) throw new AppError('Issue not found', 404);
    return includeTimeline ? timeline : timeline.issue;
  }
  const issue = await diseaseModel.findCustomerIssue(id, actorInfo.userId);
  if (!issue) throw new AppError('Issue not found', 404);
  if (!includeTimeline) {
    issue.media = await diseaseModel.findIssueMedia(id);
    return issue;
  }
  return diseaseModel.findIssueTimeline(id);
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
  customerIssues,
  customerIssue,
};
