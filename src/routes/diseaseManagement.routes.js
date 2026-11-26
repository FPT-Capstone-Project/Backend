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
 *               sessionTrayId: { type: integer, description: Required for tray issues; provide inspectionId too }
 *               inspectionId: { type: integer, description: Required for tray issues and must belong to the selected tray }
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
 *       - { in: query, name: status, schema: { type: string, enum: [OPEN, WAITING_EXPERT, IN_PROGRESS, MONITORING, WAITING_REVIEW, RESOLVED] } }
 *       - { in: query, name: severity, schema: { type: string, enum: [LOW, MEDIUM, HIGH] } }
 *       - { in: query, name: sessionId, schema: { type: integer } }
 *       - { in: query, name: page, schema: { type: integer, minimum: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100 } }
 *     responses:
 *       200: { description: Paginated issue list }
 *       403: { description: Staff role required }
 * /api/issues/qr:
 *   post:
 *     tags: [Disease Management]
 *     summary: Create an issue report and inspection for a scanned tray
 *     description: Resolves qr_token to an active paid cultivation assignment, creates a cultivation inspection for the issue report, attaches uploaded images, and creates the issue in one database transaction. Scan details can be previewed with POST /api/cultivation-trays/qr/scan.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [qr_token, issue_type, title, description]
 *             properties:
 *               qr_token: { type: string, maxLength: 256 }
 *               issue_type: { type: string, maxLength: 100 }
 *               title: { type: string, maxLength: 255 }
 *               description: { type: string }
 *               severity: { type: string, enum: [LOW, MEDIUM, HIGH] }
 *               images:
 *                 type: array
 *                 maxItems: 10
 *                 items: { type: string, format: binary }
 *     responses:
 *       201: { description: Issue and linked cultivation inspection created with uploaded images }
 *       400: { description: Invalid payload, unsupported image, or more than 10 images }
 *       403: { description: Farm Operator or Admin role required }
 *       404: { description: QR token is invalid }
 *       409: { description: Tray is not active or session is outside a reportable stage }
 * /api/issues/{issueId}:
 *   get:
 *     tags: [Disease Management]
 *     summary: Get issue details, evidence, and review history
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Issue details }
 *       404: { description: Issue not found }
 * /api/issues/{issueId}/resolve:
 *   patch:
 *     tags: [Disease Management]
 *     summary: Confirm an issue is resolved after monitoring
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reviewComment: { type: string }
 *     responses:
 *       200: { description: Issue resolved, completion recorded in expert_treatment_reviews, and consultation closed; no new treatment log is required }
 *       403: { description: Expert or Admin role required }
 *       409: { description: Issue is not monitoring or consultation is not answered }
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
 *     summary: Expert accepts a pending consultation
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Consultation assigned to the expert and moved to IN_PROGRESS }
 *       403: { description: Expert or Admin role required }
 *       409: { description: Consultation is no longer available }
 * /api/consultations/{consultationId}/respond:
 *   patch:
 *     tags: [Disease Management]
 *     summary: Submit the expert diagnosis and solution
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [diagnosis, solution]
 *             properties:
 *               diagnosis: { type: string }
 *               solution: { type: string }
 *               needsMoreInfo: { type: boolean, description: Keep consultation IN_PROGRESS and notify the operator to add information }
 *     responses:
 *       200: { description: Treatment plan marks the consultation ANSWERED and issue IN_PROGRESS; needsMoreInfo keeps both open for operator follow-up }
 *       403: { description: Expert or Admin role required }
 * /api/consultations/{consultationId}/close:
 *   patch:
 *     tags: [Disease Management]
 *     summary: Directly close a consultation and resolve the issue without treatment
 *     description: For a case that needs no operator treatment or further monitoring. Requires an expert diagnosis and closes the consultation immediately.
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
 *               reviewComment: { type: string }
 *     responses:
 *       200: { description: Consultation closed and issue resolved }
 *       409: { description: Consultation or issue is already closed }
 * /api/consultations/{consultationId}/messages:
 *   post:
 *     tags: [Disease Management]
 *     summary: Send a message or photo as an operator or the assigned expert until closure
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             description: At least one of message or file is required
 *             properties:
 *               message: { type: string, maxLength: 5000 }
 *               file: { type: string, format: binary, description: Image up to 25 MB }
 *     responses:
 *       201: { description: Message saved in conversation history; workflow status is unchanged }
 *       403: { description: Sender is not staff or is an unassigned expert }
 *       409: { description: Consultation is closed }
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
 *     responses:
 *       201: { description: Treatment recorded and issue moved to WAITING_REVIEW }
 *       409: { description: Expert solution is not available }
 *   get:
 *     tags: [Disease Management]
 *     summary: List treatments and attached media for a consultation
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: consultationId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Treatment history }
 * /api/treatments/{treatmentLogId}/review:
 *   post:
 *     tags: [Disease Management]
 *     summary: Review the latest FO treatment update
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: treatmentLogId, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reviewResult]
 *             properties:
 *               reviewResult: { type: string, enum: [APPROVED, NEEDS_MORE_ACTION] }
 *               reviewComment: { type: string }
 *     responses:
 *       200: { description: APPROVED moves the issue to MONITORING; NEEDS_MORE_ACTION moves it to IN_PROGRESS }
 *       403: { description: Expert or Admin role required }
 *       409: { description: Treatment is not the latest update awaiting review }
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
 *     summary: Get customer-visible issue, review, consultation, treatment, follow-up, and media timeline
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: issueId, required: true, schema: { type: integer } }
 *     responses:
 *       200: { description: Issue timeline }
 *       404: { description: Issue not found or not owned by customer }
 */
router.post('/issues', authenticate, controller.createIssue);
router.post('/issues/qr', authenticate, mediaUpload.array('images', 10), controller.createIssueFromQr);
router.get('/issues', authenticate, controller.listIssues);
router.get('/issues/:issueId', authenticate, controller.getIssue);
router.patch('/issues/:issueId/resolve', authenticate, controller.resolveIssue);
router.post('/issues/:issueId/media', authenticate, mediaUpload.single('file'), controller.addIssueMedia);
router.post('/issues/:issueId/consultations', authenticate, controller.createConsultation);

router.get('/consultations', authenticate, controller.listConsultations);
router.get('/consultations/:consultationId', authenticate, controller.getConsultation);
router.patch('/consultations/:consultationId/assign', authenticate, controller.assignConsultation);
router.patch('/consultations/:consultationId/respond', authenticate, controller.respondToConsultation);
router.patch('/consultations/:consultationId/close', authenticate, controller.closeConsultation);
router.post('/consultations/:consultationId/messages', authenticate, mediaUpload.single('file'), controller.addConsultationMessage);
router.post('/consultations/:consultationId/treatments', authenticate, controller.createTreatment);
router.get('/consultations/:consultationId/treatments', authenticate, controller.getTreatments);

router.post('/treatments/:treatmentLogId/review', authenticate, controller.reviewTreatment);
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
