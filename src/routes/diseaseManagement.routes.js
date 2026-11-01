const express = require('express');
const controller = require('../controllers/diseaseManagement.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const mediaUpload = require('../middlewares/mediaUpload.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/issues:
 *   post:
 *     tags: [Disease Management]
 *     summary: Create a spawn- or tray-based cultivation issue
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [issueType, title, description]
 *             properties:
 *               sessionTrayId: { type: integer, description: Required for tray issues }
 *               inspectionId: { type: integer, description: Optional tray inspection }
 *               spawnInspectionId: { type: integer, description: Required for spawn issues }
 *               issueType: { type: string }
 *               title: { type: string }
 *               description: { type: string }
 *               severity: { type: string, enum: [LOW, MEDIUM, HIGH] }
 *     responses:
 *       201: { description: Issue created; stage and sensor context are included in the response but not persisted }
 *       400: { description: Invalid issue source or payload }
 *       403: { description: Farm Operator or Admin role required }
 *       404: { description: Source inspection not found }
 *       409: { description: Session is not in the relevant cultivation stage }
 *   get:
 *     tags: [Disease Management]
 *     summary: List issues with status, severity, and session filters
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [OPEN, WAITING_EXPERT, IN_PROGRESS, MONITORING, RESOLVED] } }
 *       - { in: query, name: severity, schema: { type: string, enum: [LOW, MEDIUM, HIGH] } }
 *       - { in: query, name: sessionId, schema: { type: integer } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100 } }
 *     responses:
 *       200: { description: Paginated issue list }
 *       403: { description: Staff role required }
 * /api/issues/{issueId}:
 *   get:
 *     tags: [Disease Management]
 *     summary: Get issue details and evidence media
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Issue details }
 *       404: { description: Issue not found }
 * /api/issues/{issueId}/status:
 *   patch:
 *     tags: [Disease Management]
 *     summary: Change issue status using an allowed workflow transition
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [IN_PROGRESS, MONITORING]
 *     responses:
 *       200: { description: Issue status updated using statuses supported by the current database }
 *       409: { description: Invalid workflow transition or missing treatment result }
 * /api/issues/{issueId}/resolve:
 *   patch:
 *     tags: [Disease Management]
 *     summary: Resolve an issue after expert review
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Issue resolved }
 *       403: { description: Assigned expert or Admin role required }
 *       409: { description: Issue is not in MONITORING status }
 * /api/issues/{issueId}/media:
 *   post:
 *     tags: [Disease Management]
 *     summary: Upload an issue image to its linked inspection image history
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *               caption: { type: string }
 *     responses:
 *       201: { description: Image added to the linked inspection image history }
 *       400: { description: Only images are supported by the current issue-image tables }
 *       409: { description: Issue has no linked inspection or evidence is locked }
 * /api/issues/{issueId}/consultations:
 *   post:
 *     tags: [Disease Management]
 *     summary: Request expert consultation for an issue
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question]
 *             properties:
 *               question: { type: string }
 *     responses:
 *       201: { description: Consultation created and experts notified }
 *       409: { description: Issue already has an active consultation }
 * /api/consultations:
 *   get:
 *     tags: [Disease Management]
 *     summary: List consultations for experts
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, IN_PROGRESS, ANSWERED, CLOSED] } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100 } }
 *     responses:
 *       200: { description: Paginated consultation list }
 *       403: { description: Expert or Admin role required }
 * /api/consultations/{consultationId}:
 *   get:
 *     tags: [Disease Management]
 *     summary: Get consultation, treatment, and question follow-up history
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Consultation details }
 *       404: { description: Consultation not found }
 * /api/consultations/{consultationId}/assign:
 *   patch:
 *     tags: [Disease Management]
 *     summary: Accept a consultation or assign an expert as Admin
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               expertId: { type: integer, description: Required for Admin assignment }
 *     responses:
 *       200: { description: Consultation assigned }
 *       400: { description: Selected account is not an expert }
 * /api/consultations/{consultationId}/respond:
 *   patch:
 *     tags: [Disease Management]
 *     summary: Submit diagnosis and solution or request more information
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [diagnosis]
 *             properties:
 *               diagnosis: { type: string }
 *               solution: { type: string }
 *               needsMoreInfo: { type: boolean }
 *     responses:
 *       200: { description: Expert response submitted; request-more-info maps to PENDING consultation and WAITING_EXPERT issue }
 *       403: { description: Assigned expert or Admin role required }
 * /api/consultations/{consultationId}/close:
 *   patch:
 *     tags: [Disease Management]
 *     summary: Close a responded consultation
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Consultation closed }
 * /api/consultations/{consultationId}/messages:
 *   post:
 *     tags: [Disease Management]
 *     summary: Append follow-up information to the consultation question
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string }
 *     responses:
 *       201: { description: Follow-up appended to the consultation question and returned to the assigned expert; no separate message table is used }
 * /api/consultations/{consultationId}/treatments:
 *   post:
 *     tags: [Disease Management]
 *     summary: Record an operator treatment action and outcome
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [actionDescription]
 *             properties:
 *               actionDescription: { type: string }
 *               resultDescription: { type: string }
 *               performedAt: { type: string, format: date-time }
 *     responses:
 *       201: { description: Treatment recorded }
 *       409: { description: Expert solution is not available }
 *   get:
 *     tags: [Disease Management]
 *     summary: List treatments and attached media for a consultation
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Treatment history }
 * /api/treatments/{treatmentLogId}/media:
 *   post:
 *     tags: [Disease Management]
 *     summary: Upload treatment evidence to Cloudinary and save its URL
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: treatmentLogId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, mediaStage]
 *             properties:
 *               file: { type: string, format: binary }
 *               mediaStage: { type: string, enum: [BEFORE, DURING, AFTER] }
 *               caption: { type: string }
 *     responses:
 *       201: { description: Media uploaded }
 * /api/treatments/{treatmentLogId}/media/{mediaId}:
 *   delete:
 *     tags: [Disease Management]
 *     summary: Delete treatment media before issue review locks it
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: treatmentLogId, required: true, schema: { type: integer } }
 *       - { in: path, name: mediaId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Media deleted from Cloudinary and database using its stored URL }
 *       409: { description: Media is locked or stored URL is not a Cloudinary URL }
 * /api/customer/sessions/{sessionId}/issues:
 *   get:
 *     tags: [Disease Management]
 *     summary: List issues for a session owned by the authenticated customer
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: sessionId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Session issue list }
 *       404: { description: Session not found or not owned by customer }
 * /api/customer/issues/{issueId}:
 *   get:
 *     tags: [Disease Management]
 *     summary: Get an issue owned by the authenticated customer
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Customer-visible issue }
 *       404: { description: Issue not found or not owned by customer }
 * /api/customer/issues/{issueId}/timeline:
 *   get:
 *     tags: [Disease Management]
 *     summary: Get customer-visible issue, consultation, treatment, follow-up, and media timeline
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Issue timeline }
 *       404: { description: Issue not found or not owned by customer }
 */
router.post('/issues', authenticate, controller.createIssue);
router.get('/issues', authenticate, controller.listIssues);
router.get('/issues/:issueId', authenticate, controller.getIssue);
router.patch('/issues/:issueId/status', authenticate, controller.changeIssueStatus);
router.patch('/issues/:issueId/resolve', authenticate, controller.resolveIssue);
router.post('/issues/:issueId/media', authenticate, mediaUpload.single('file'), controller.addIssueMedia);
router.post('/issues/:issueId/consultations', authenticate, controller.createConsultation);

router.get('/consultations', authenticate, controller.listConsultations);
router.get('/consultations/:consultationId', authenticate, controller.getConsultation);
router.patch('/consultations/:consultationId/assign', authenticate, controller.assignConsultation);
router.patch('/consultations/:consultationId/respond', authenticate, controller.respondToConsultation);
router.patch('/consultations/:consultationId/close', authenticate, controller.closeConsultation);
router.post('/consultations/:consultationId/messages', authenticate, controller.addConsultationMessage);
router.post('/consultations/:consultationId/treatments', authenticate, controller.createTreatment);
router.get('/consultations/:consultationId/treatments', authenticate, controller.getTreatments);

router.post(
  '/treatments/:treatmentLogId/media',
  authenticate,
  mediaUpload.single('file'),
  controller.addTreatmentMedia,
);
router.delete(
  '/treatments/:treatmentLogId/media/:mediaId',
  authenticate,
  controller.deleteTreatmentMedia,
);

module.exports = router;
