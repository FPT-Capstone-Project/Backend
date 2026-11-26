const diseaseModel = require('../models/diseaseManagement.model');
const cloudinaryService = require('./cloudinary.service');
const AppError = require('../utils/app-error');

const ISSUE_STATUSES = [
  'OPEN',
  'WAITING_EXPERT',
  'IN_PROGRESS',
  'MONITORING',
  'WAITING_REVIEW',
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
  if (sessionTrayId !== undefined && inspectionId === undefined) {
    throw new AppError('inspectionId is required for a tray issue', 400);
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

async function createIssueFromQr(user, payload = {}, files = []) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const qrToken = parseText(
    payload.qrToken ?? payload.qr_token,
    'qrToken',
    { required: true, maxLength: 256 },
  );
  const issueType = parseText(payload.issueType ?? payload.issue_type, 'issueType', {
    required: true,
    maxLength: 100,
  }).toUpperCase();
  const title = parseText(payload.title, 'title', { required: true, maxLength: 255 });
  const description = parseText(payload.description, 'description', { required: true });
  const severity = parseOptionalEnum(payload.severity, 'severity', SEVERITIES);
  if (!Array.isArray(files) || files.length > 10) {
    throw new AppError('A maximum of 10 issue images may be uploaded', 400);
  }
  if (files.some((file) => !file.mimetype?.startsWith('image/'))) {
    throw new AppError('Only images may be attached to a QR issue report', 400);
  }

  const uploaded = [];
  try {
    for (const file of files) {
      uploaded.push(await cloudinaryService.uploadMedia(file, 'cultivation-inspections'));
    }
    return await diseaseModel.createIssueFromQr({
      qrToken,
      issueType,
      title,
      description,
      severity,
      imageUrls: uploaded.map((image) => image.mediaUrl),
    }, actorInfo.userId);
  } catch (error) {
    const cleanup = await Promise.allSettled(
      uploaded.map((image) => cloudinaryService.deleteMedia(image.publicId, image.resourceType)),
    );
    cleanup.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('QR issue image cleanup failed:', result.reason.message);
      }
    });
    throw error;
  }
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
  issue.reviews = await diseaseModel.findIssueReviews(id);
  return issue;
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
  if (typeof payload.question === 'string' && payload.question.trim().startsWith('MCMS_CHAT_V1:')) {
    throw new AppError('question uses a reserved storage prefix', 400);
  }
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

async function addConsultationMessage(user, consultationId, payload = {}, file) {
  const actorInfo = await getActor(user);
  requireStaff(actorInfo);
  const id = parseId(consultationId, 'consultationId');
  const message = parseText(payload.message, 'message', { required: !file });
  if (file && !file.mimetype?.startsWith('image/')) throw new AppError('Only images are allowed', 400);
  const consultation = await diseaseModel.findConsultation(id);
  if (!consultation) throw new AppError('Consultation not found', 404);
  if (consultation.status === 'CLOSED' || consultation.issue_status === 'RESOLVED') throw new AppError('Consultation is closed', 409);
  if (isExpert(actorInfo) && !isAdmin(actorInfo) && Number(consultation.expert_id) !== actorInfo.userId) {
    throw new AppError('Only the assigned expert can reply', 403);
  }
  const media = file ? await cloudinaryService.uploadMedia(file, 'mushroom-disease/messages') : null;
  try {
    return await diseaseModel.createConsultationMessage(id, message, actorInfo.userId, {
      isExpert: isExpert(actorInfo), isAdmin: isAdmin(actorInfo), mediaUrl: media?.mediaUrl,
    });
  } catch (error) {
    if (media) {
      try { await cloudinaryService.deleteMedia(media.publicId, media.resourceType); }
      catch (cleanupError) { console.error('Unable to clean up consultation photo:', cleanupError); }
    }
    throw error;
  }
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
  consultation.treatments = await diseaseModel.findTreatments(id);
  consultation.messages = await diseaseModel.findConsultationMessages(id);
  return consultation;
}

async function assignConsultation(user, consultationId) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  return diseaseModel.assignConsultation(
    parseId(consultationId, 'consultationId'),
    actorInfo.userId,
  );
}

async function respondToConsultation(user, consultationId, payload = {}) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  const id = parseId(consultationId, 'consultationId');
  const consultation = await diseaseModel.findConsultation(id);
  if (!consultation) throw new AppError('Consultation not found', 404);
  return diseaseModel.respondToConsultation(id, {
    diagnosis: parseText(payload.diagnosis, 'diagnosis', { required: true }),
    solution: parseText(payload.solution, 'solution'),
    needsMoreInfo: payload.needsMoreInfo === true,
  }, actorInfo.userId);
}

async function closeConsultation(user, consultationId, payload = {}) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  return diseaseModel.closeConsultation(
    parseId(consultationId, 'consultationId'),
    actorInfo.userId,
    {
      diagnosis: parseText(payload.diagnosis, 'diagnosis', { required: true }),
      comment: parseText(payload.reviewComment ?? payload.review_comment, 'reviewComment'),
    },
  );
}

async function createTreatment(user, consultationId, payload = {}) {
  const actorInfo = await getActor(user);
  requireFarmOperator(actorInfo);
  const id = parseId(consultationId, 'consultationId');
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
  }, actorInfo.userId);
  return treatment;
}

async function reviewTreatment(user, treatmentLogId, payload = {}) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  const id = parseId(treatmentLogId, 'treatmentLogId');
  const result = parseOptionalEnum(
    payload.reviewResult ?? payload.review_result,
    'reviewResult',
    ['APPROVED', 'NEEDS_MORE_ACTION'],
  );
  if (!result) throw new AppError('reviewResult is required', 400);
  return diseaseModel.reviewTreatment(id, {
    result,
    comment: parseText(payload.reviewComment ?? payload.review_comment, 'reviewComment'),
  }, actorInfo.userId);
}

async function resolveIssue(user, issueId, payload = {}) {
  const actorInfo = await getActor(user);
  requireExpert(actorInfo);
  return diseaseModel.resolveIssue(
    parseId(issueId, 'issueId'),
    actorInfo.userId,
    parseText(payload.reviewComment ?? payload.review_comment, 'reviewComment'),
  );
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
  if (treatment.issue_status !== 'WAITING_REVIEW') {
    throw new AppError('Treatment media can only be uploaded while waiting for review', 409);
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
  if (media.issue_status !== 'WAITING_REVIEW') {
    throw new AppError('Treatment media can only be changed while waiting for review', 409);
  }
  if (Number(media.latest_treatment_log_id) !== Number(treatment.treatment_log_id)) {
    throw new AppError('Only the latest treatment update can be changed', 409);
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
    issue.reviews = await diseaseModel.findIssueReviews(id);
    return issue;
  }
  return diseaseModel.findIssueTimeline(id);
}

module.exports = {
  createIssue,
  createIssueFromQr,
  listIssues,
  getIssue,
  addIssueMedia,
  createConsultation,
  addConsultationMessage,
  listConsultations,
  getConsultation,
  assignConsultation,
  respondToConsultation,
  closeConsultation,
  createTreatment,
  reviewTreatment,
  resolveIssue,
  getTreatments,
  addTreatmentMedia,
  deleteTreatmentMedia,
  customerIssues,
  customerIssue,
};
