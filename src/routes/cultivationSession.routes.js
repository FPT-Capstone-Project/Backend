const express = require('express');
const multer = require('multer');
const cultivationSessionController = require('../controllers/cultivationSession.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');
const AppError = require('../utils/app-error');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];
const adminOnly = [authenticate, authorizeRoles(1)];
const parseTrayGrowthForm = multer({ limits: { fields: 5, fieldSize: 4096 } }).none();

function trayGrowthForm(req, res, next) {
  if (!req.is('multipart/form-data')) {
    return next(new AppError('Content-Type must be multipart/form-data', 400));
  }
  parseTrayGrowthForm(req, res, (error) => {
    next(error && !(error instanceof multer.MulterError)
      ? new AppError('Invalid multipart form data', 400)
      : error);
  });
}

/**
 * @openapi
 * /api/cultivation-sessions/admin:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: List cultivation sessions for Admin and Farm Operator
 *     description: 'Roles: 1 = Admin, 2 = Farm Operator, 3 = Customer. Only roles 1 and 2 may access. Returns data and pagination using the existing session filters.'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Cultivation session list with pagination }
 *       400: { description: Invalid filters or pagination }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 */
router.get('/admin', adminOrFarmOperator, cultivationSessionController.adminList);

/**
 * @openapi
 * /api/cultivation-sessions/admin/available-trays:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: List trays currently assignable to a qualified cultivation session
 *     description: Returns AVAILABLE trays with ACTIVE positions in the same floor and room, on ACTIVE floors with no active cultivation-session assignment. Optionally filter by floorId. Read-only preview; assignment rechecks positions and availability under row locks.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: floorId
 *         schema: { type: integer, minimum: 1 }
 *         description: Optional active cultivation floor ID
 *     responses:
 *       200:
 *         description: Active-floor trays available for assignment
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       tray_id: { type: integer, example: 21 }
 *                       tray_code: { type: string, example: F2-TRAY-01 }
 *                       floor_id: { type: integer, example: 2 }
 *                       floor_name: { type: string, example: Floor 2 }
 *                       position_id: { type: integer, example: 12 }
 *                       row_number: { type: integer, example: 1 }
 *                       column_number: { type: integer, example: 2 }
 *                       status: { type: string, example: AVAILABLE }
 *       400: { description: Invalid floor ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 */
router.get('/admin/available-trays', adminOrFarmOperator, cultivationSessionController.adminListAvailableTrays);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: Get a cultivation session with latest progress and assigned trays
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "Session detail including status, harvest_status, harvest_ready, growth_status, progress_percent, condition, notes, mushroom, and trays with floor details" }
 *       400: { description: Invalid session ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session not found }
 */
router.get('/admin/:sessionId', adminOrFarmOperator, cultivationSessionController.adminGetById);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/trays:
 *   post:
 *     tags: [Cultivation Sessions]
 *     summary: Assign selected floor and trays to a ready cultivation session
 *     description: Submit floorId and trayIds explicitly. The Farm Operator determines cultivation suitability. All selected trays must belong to the ACTIVE floor with ACTIVE positions in the same room. Atomic assignment requires READY_FOR_CULTIVATION and exactly tray_quantity trays. Success starts CULTIVATING with initial progress at 0 percent.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [floorId, trayIds]
 *             properties:
 *               floorId: { type: integer, minimum: 1, example: 2 }
 *               trayIds:
 *                 type: array
 *                 minItems: 1
 *                 uniqueItems: true
 *                 items: { type: integer, minimum: 1 }
 *                 example: [21, 22, 25]
 *     responses:
 *       201:
 *         description: Selected floor and trays assigned; session is CULTIVATING
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     session_id: { type: integer, example: 9 }
 *                     status: { type: string, example: CULTIVATING }
 *                     floor:
 *                       type: object
 *                       properties:
 *                         floor_id: { type: integer, example: 2 }
 *                         floor_name: { type: string, example: Floor 2 }
 *                     required_trays: { type: integer, example: 3 }
 *                     assigned_trays_count: { type: integer, example: 3 }
 *                     assigned_trays:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           session_tray_id: { type: integer, example: 31 }
 *                           tray_id: { type: integer, example: 21 }
 *                           tray_code: { type: string, example: F2-TRAY-01 }
 *                           status: { type: string, example: ACTIVE }
 *       400: { description: Invalid session ID, floor ID, or selected tray IDs }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session, floor, or selected tray not found }
 *       409: { description: 'INVALID_SESSION_STATUS, INVALID_TRAY_QUANTITY, FLOOR_NOT_ACTIVE, TRAY_FLOOR_MISMATCH, TRAY_UNAVAILABLE, TRAY_POSITION_UNAVAILABLE, or TRAYS_ALREADY_ASSIGNED' }
 */
router.post('/admin/:sessionId/trays', adminOrFarmOperator, cultivationSessionController.adminAssignTrays);

/**
 * @openapi
 * /api/cultivation-sessions/admin/inspections:
 *   post:
 *     tags: [Cultivation Audit]
 *     summary: Record a daily tray inspection using a QR token or session tray ID
 *     description: Send exactly one of qr_token or session_tray_id. Blank optional fields, including values sent by Swagger UI's Send empty value option, are treated as omitted. QR mode resolves the tray and its ACTIVE session-tray assignment; manual mode looks up the supplied session_tray_id directly and requires it to be ACTIVE. The session must be CULTIVATING and may have at most one MANUAL (or legacy NULL-source) inspection per Vietnam calendar day; AUTO inspections do not count toward this limit. The inspector is taken from the authenticated user; tray_id, session_id, and inspected_by are not required. Each uploaded image is stored as a separate record linked to the new inspection_id.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               qr_token: { type: string, description: QR mode; backend finds the tray and its active session-tray assignment }
 *               session_tray_id: { type: integer, description: Manual mode; must identify an ACTIVE session-tray assignment }
 *               trayCondition: { type: string }
 *               mushroomCondition: { type: string }
 *               notes: { type: string }
 *               caption: { type: string, description: Optional caption applied to each uploaded image }
 *               images:
 *                 type: array
 *                 maxItems: 10
 *                 items: { type: string, format: binary }
 *             oneOf:
 *               - required: [qr_token]
 *               - required: [session_tray_id]
 *     responses:
 *       201: { description: Inspection and uploaded images created }
 *       400: { description: Send exactly one non-empty qr_token or session_tray_id; sending both or neither is invalid }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: QR không hợp lệ, Khay chưa được gắn vào phiên trồng, or session_tray_id does not exist }
 *       409: { description: Khay đã được RELEASED, session is not CULTIVATING, or a MANUAL/NULL-source inspection already exists today }
 */
router.post(
  '/admin/inspections',
  adminOrFarmOperator,
  upload.array('images', 10),
  cultivationSessionController.adminCreateInspection,
);

/**
 * @openapi
 * /api/cultivation-sessions/admin/session-trays/{sessionTrayId}/inspections:
 *   post:
 *     tags: [Cultivation Audit]
 *     summary: Record a daily tray inspection for a session tray (legacy route)
 *     description: Legacy route; new clients should POST to /api/cultivation-sessions/admin/inspections with session_tray_id or qr_token. Records at most one MANUAL (or legacy NULL-source) inspection per assigned tray per Vietnam calendar day; AUTO inspections do not count toward this limit.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionTrayId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               trayCondition:
 *                 type: string
 *               mushroomCondition:
 *                 type: string
 *               notes:
 *                 type: string
 *               caption:
 *                 type: string
 *                 description: Optional caption applied to each uploaded image
 *               images:
 *                 type: array
 *                 maxItems: 10
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       201:
 *         description: Tray inspection recorded
 *       400:
 *         description: Invalid inspection input
 *       404:
 *         description: Session tray not found
 *       409:
 *         description: Session tray is not active or already has a MANUAL/NULL-source inspection today
 */
router.post(
  '/admin/session-trays/:sessionTrayId/inspections',
  adminOrFarmOperator,
  upload.array('images', 10),
  cultivationSessionController.adminCreateInspection,
);

/**
 * @openapi
 * /api/cultivation-sessions/admin/session-trays/{sessionTrayId}/inspections/{inspectionId}:
 *   put:
 *     tags: [Cultivation Audit]
 *     summary: Update an existing daily tray inspection
 *     description: Replaces the observation fields for an inspection belonging to this assigned tray. The inspection date and existing images are unchanged. Historical observations can be edited even after the session is no longer active.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: sessionTrayId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *       - in: path
 *         name: inspectionId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trayCondition: { type: string, maxLength: 500 }
 *               mushroomCondition: { type: string, maxLength: 500 }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Daily tray inspection updated }
 *       400: { description: Invalid inspection data }
 *       404: { description: Session tray or inspection not found for that tray }
 */
router.put(
  '/admin/session-trays/:sessionTrayId/inspections/:inspectionId',
  adminOrFarmOperator,
  cultivationSessionController.adminUpdateInspection,
);

/**
 * @openapi
 * /api/cultivation-sessions/admin/inspections/{inspectionId}/images:
 *   post:
 *     tags: [Cultivation Audit]
 *     summary: Upload an image for a cultivation inspection
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: inspectionId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, format: binary }
 *               caption: { type: string }
 *     responses:
 *       201: { description: Inspection image uploaded }
 *       400: { description: Invalid image or request input }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Inspection not found }
 */
router.post(
  '/admin/inspections/:inspectionId/images',
  adminOrFarmOperator,
  upload.single('image'),
  cultivationSessionController.adminAddInspectionImage,
);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/incidents:
 *   post:
 *     tags: [Cultivation Audit]
 *     summary: Record an immutable cultivation incident for an active session tray
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionTrayId, incidentType]
 *             properties:
 *               sessionTrayId: { type: integer }
 *               inspectionId: { type: integer }
 *               incidentType:
 *                 type: string
 *                 enum: [NO_PINNING, SLOW_GROWTH, DRY_SHRIVELED, MUSHY, DEFORMED_GROWTH, CONTAMINATION, DISEASE, DAMAGE, SENSOR_DATA_LOSS, DEVICE_FAILURE, DELAYED_MATURATION, QUALITY_FAILURE, OTHER]
 *               severity: { type: string, enum: [LOW, MEDIUM, HIGH] }
 *               description: { type: string }
 *               actionTaken: { type: string }
 *               nextAction: { type: string }
 *   get:
 *     tags: [Cultivation Audit]
 *     summary: List cultivation incident history for a session
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Incident history }
 *       400: { description: Invalid incident input or session ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session not found }
 *       409: { description: Session is not in a valid incident-recording state }
 */
router.post('/admin/:sessionId/incidents', adminOrFarmOperator, cultivationSessionController.adminCreateIncident);
router.get('/admin/:sessionId/incidents', adminOrFarmOperator, cultivationSessionController.adminListIncidents);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/growth:
 *   patch:
 *     tags: [Cultivation Sessions]
 *     summary: Update current mushroom growth condition and progress
 *     description: |
 *       Select a growth status from Examples below, then click Try it out to send the request.
 *       Example percentages are testing and operational guidelines, not validation constraints between growthStatus and progressPercent.
 *       progressPercent must be between 0 and 100 and cannot decrease from the previous update.
 *       growthStatus corresponds to the four WF-03 stages in order: FRUITING_INITIATION, PINNING, YOUNG_FRUITING, and MATURATION.
 *       condition describes the observed condition, for example NORMAL. notes is optional. expectedHarvestDate optionally updates the forecast (YYYY-MM-DD), records it in history, and notifies the customer. New growth observations reset readiness and require a fresh assessment.
 *       MATURATION or 100% does not automatically set HARVEST_READY. Call PATCH /api/cultivation-sessions/admin/{sessionId}/harvest-readiness with harvestReady=true to confirm readiness separately.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [growthStatus, progressPercent, condition]
 *             properties:
 *               growthStatus: { type: string, enum: [FRUITING_INITIATION, PINNING, YOUNG_FRUITING, MATURATION], example: FRUITING_INITIATION }
 *               progressPercent: { type: number, minimum: 0, maximum: 100, example: 10 }
 *               condition: { type: string, minLength: 1, maxLength: 500, example: NORMAL }
 *               notes: { type: string, maxLength: 1000 }
 *               expectedHarvestDate: { type: string, format: date, example: 2026-11-10 }
 *           examples:
 *             FRUITING_INITIATION:
 *               summary: FRUITING_INITIATION
 *               value: { growthStatus: FRUITING_INITIATION, progressPercent: 10, condition: NORMAL, notes: Spawn has been placed on the assigned trays and fruiting initiation has started. }
 *             PINNING:
 *               summary: PINNING
 *               value: { growthStatus: PINNING, progressPercent: 30, condition: NORMAL, notes: Initial mushroom pins are appearing normally. }
 *             YOUNG_FRUITING:
 *               summary: YOUNG_FRUITING
 *               value: { growthStatus: YOUNG_FRUITING, progressPercent: 60, condition: NORMAL, notes: Young fruiting bodies are developing normally. }
 *             MATURATION:
 *               summary: MATURATION
 *               value: { growthStatus: MATURATION, progressPercent: 90, condition: NORMAL, notes: Mushrooms are approaching the expected mature condition and should be evaluated for harvest readiness. }
 *     responses:
 *       200: { description: Growth history recorded; session remains CULTIVATING }
 *       400: { description: Invalid input }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session not found }
 *       409: { description: Invalid session state or growth regression }
 */
router.patch('/admin/:sessionId/growth', adminOrFarmOperator, cultivationSessionController.adminUpdateGrowth);

/**
 * @openapi
 * components:
 *   schemas:
 *     CultivationTrayGrowthStage:
 *       type: string
 *       enum: [FRUITING_INITIATION, PINNING, YOUNG_FRUITING, MATURATION]
 *     CultivationTrayGrowthSynchronization:
 *       type: object
 *       required: [is_synchronized, total_trays, updated_trays, matching_trays]
 *       properties:
 *         is_synchronized: { type: boolean, description: True when at least one tray is active and every active tray shares a recorded stage }
 *         total_trays: { type: integer, minimum: 0 }
 *         updated_trays: { type: integer, minimum: 0, description: Active trays with a recorded growth stage }
 *         matching_trays: { type: integer, minimum: 0, description: Number of active trays at the scan target for POST or in the largest group sharing a stage for GET }
 * /api/cultivation-sessions/admin/qr-growth-update:
 *   post:
 *     tags: [Cultivation Sessions]
 *     summary: Record a tray's growth stage by QR code
 *     description: Admin and Farm Operator only. Updates the tray's inspection for the current Vietnam calendar day or creates one. A shared stage across all active trays is appended to session progress when it differs from the latest session stage.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             additionalProperties: false
 *             required: [qr_token, growth_status]
 *             properties:
 *               qr_token: { type: string, minLength: 1, maxLength: 256 }
 *               growth_status: { $ref: '#/components/schemas/CultivationTrayGrowthStage' }
 *               trayCondition: { type: string, maxLength: 500 }
 *               mushroomCondition: { type: string, maxLength: 500 }
 *               notes: { type: string, maxLength: 1000 }
 *     responses:
 *       200:
 *         description: Tray growth recorded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, message, data]
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   required: [session_id, tray_id, tray_code, growth_status, synchronization]
 *                   properties:
 *                     session_id: { type: integer }
 *                     tray_id: { type: integer }
 *                     tray_code: { type: string }
 *                     growth_status: { $ref: '#/components/schemas/CultivationTrayGrowthStage' }
 *                     synchronization:
 *                       allOf:
 *                         - $ref: '#/components/schemas/CultivationTrayGrowthSynchronization'
 *                         - type: object
 *                           required: [session_stage]
 *                           properties:
 *                             session_stage: { type: string, nullable: true }
 *             examples:
 *               pending:
 *                 value:
 *                   success: true
 *                   message: Tray growth status updated successfully
 *                   data:
 *                     session_id: 21
 *                     tray_id: 1
 *                     tray_code: TRAY-001
 *                     growth_status: PINNING
 *                     synchronization: { is_synchronized: false, session_stage: FRUITING_INITIATION, total_trays: 3, updated_trays: 3, matching_trays: 2 }
 *               synchronized:
 *                 value:
 *                   success: true
 *                   message: All trays synchronized. Session growth stage updated successfully
 *                   data:
 *                     session_id: 21
 *                     tray_id: 3
 *                     tray_code: TRAY-003
 *                     growth_status: PINNING
 *                     synchronization: { is_synchronized: true, session_stage: PINNING, total_trays: 3, updated_trays: 3, matching_trays: 3 }
 *       400: { description: Invalid multipart form, fields, QR token, or growth stage }
 *       401: { description: Authentication required }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: QR token not found }
 *       409: { description: Tray has no active assignment or session is outside the CULTIVATING lifecycle state }
 *       500: { description: Internal server error }
 */
router.post(
  '/admin/qr-growth-update',
  adminOrFarmOperator,
  trayGrowthForm,
  cultivationSessionController.adminUpdateTrayGrowthFromQr,
);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/growth-status:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: Get the recorded growth status of every active tray
 *     description: Admin and Farm Operator only. Reports the latest non-null growth stage and its inspection timestamp for each active tray. Sessions with zero active trays return an empty array and false synchronization.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer, minimum: 1, maximum: 2147483647 }
 *     responses:
 *       200:
 *         description: Current session stage and active tray growth
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [success, data]
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   required: [session_id, session_stage, synchronization, trays]
 *                   properties:
 *                     session_id: { type: integer }
 *                     session_stage: { type: string, nullable: true }
 *                     synchronization: { $ref: '#/components/schemas/CultivationTrayGrowthSynchronization' }
 *                     trays:
 *                       type: array
 *                       items:
 *                         type: object
 *                         required: [session_tray_id, tray_id, tray_code, tray_status, growth_status, updated, last_inspection_at]
 *                         properties:
 *                           session_tray_id: { type: integer }
 *                           tray_id: { type: integer }
 *                           tray_code: { type: string }
 *                           tray_status: { type: string, enum: [AVAILABLE, OCCUPIED, MAINTENANCE, INACTIVE] }
 *                           growth_status: { type: string, nullable: true, enum: [FRUITING_INITIATION, PINNING, YOUNG_FRUITING, MATURATION, null] }
 *                           updated: { type: boolean }
 *                           last_inspection_at: { type: string, format: date-time, nullable: true }
 *             example:
 *               success: true
 *               data:
 *                 session_id: 21
 *                 session_stage: FRUITING_INITIATION
 *                 synchronization: { is_synchronized: false, total_trays: 2, updated_trays: 1, matching_trays: 1 }
 *                 trays:
 *                   - { session_tray_id: 15, tray_id: 1, tray_code: TRAY-001, tray_status: OCCUPIED, growth_status: PINNING, updated: true, last_inspection_at: '2026-11-25T10:00:00+07:00' }
 *                   - { session_tray_id: 16, tray_id: 2, tray_code: TRAY-002, tray_status: OCCUPIED, growth_status: null, updated: false, last_inspection_at: null }
 *       400: { description: Invalid session ID }
 *       401: { description: Authentication required }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Cultivation session not found }
 *       500: { description: Internal server error }
 */
router.get('/admin/:sessionId/growth-status', adminOrFarmOperator, cultivationSessionController.adminGetTrayGrowthStatus);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/harvest-readiness:
 *   patch:
 *     tags: [Cultivation Sessions]
 *     summary: Confirm whether the cultivation session is ready for harvesting
 *     description: 'Only CULTIVATING sessions with all required trays ACTIVE and OCCUPIED and a recorded growth condition can be assessed. True requires MATURATION and no unresolved quality or HIGH-severity incidents, and sets harvest_status to HARVEST_READY while status stays CULTIVATING. False sets NOT_READY. The confirming operator and time are recorded and the customer is notified when ready. The assessment and optional notes are appended to history. This API never performs harvesting.'
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [harvestReady]
 *             properties:
 *               harvestReady: { type: boolean, example: true }
 *               notes: { type: string, maxLength: 1000 }
 *     responses:
 *       200: { description: Harvest readiness assessment recorded }
 *       400: { description: Invalid input }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session not found }
 *       409: { description: Invalid session state, missing trays or growth condition, or immature growth }
 */
router.patch('/admin/:sessionId/harvest-readiness', adminOrFarmOperator, cultivationSessionController.adminUpdateHarvestReadiness);

/**
 * @openapi
 * /api/cultivation-sessions/{sessionId}/daily-inspections:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: Get all daily mushroom observations across a cultivation session's trays
 *     description: Returns observations for every tray assigned to the session, including growth stage/progress, tray and mushroom conditions, notes, inspector, and uploaded images. Admins and Farm Operators can view any session; Customers can view sessions belonging to their account.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Daily observations across all session trays with pagination }
 *       400: { description: Invalid session ID or pagination }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin, Farm Operator, or Customer role required }
 *       404: { description: Session not found or not accessible to this customer }
 */
router.get(
  '/:sessionId/daily-inspections',
  authenticate,
  authorizeRoles(1, 2, 3),
  cultivationSessionController.getDailyInspectionHistory,
);
router.get(
  '/admin/:sessionId/daily-inspections',
  authenticate,
  authorizeRoles(1, 2, 3),
  cultivationSessionController.getDailyInspectionHistory,
);

/**
 * @openapi
 * /api/cultivation-sessions/{sessionId}/trays/{sessionTrayId}/daily-inspections:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: Get daily mushroom observation history for one tray in a session
 *     description: sessionTrayId identifies the tray assignment within the session. Customers can only access their own sessions; Admins and Farm Operators can access any session.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *       - in: path
 *         name: sessionTrayId
 *         required: true
 *         description: Session tray assignment ID, not the physical tray ID
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Daily observations and images for the selected session tray }
 *       400: { description: Invalid session, tray assignment, or pagination }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin, Farm Operator, or Customer role required }
 *       404: { description: Session not found or tray assignment does not belong to this session }
 */
router.get(
  '/:sessionId/trays/:sessionTrayId/daily-inspections',
  authenticate,
  authorizeRoles(1, 2, 3),
  cultivationSessionController.getTrayDailyInspectionHistory,
);
router.get(
  '/admin/:sessionId/trays/:sessionTrayId/daily-inspections',
  authenticate,
  authorizeRoles(1, 2, 3),
  cultivationSessionController.getTrayDailyInspectionHistory,
);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/progress:
 *   get:
 *     tags: [Cultivation Audit]
 *     summary: Get immutable WF-03 progress history for a cultivation session
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: "Session status, harvest status, latest progress, and complete progress history" }
 *       400: { description: Invalid session ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session not found }
 */
router.get('/admin/:sessionId/progress', adminOrFarmOperator, cultivationSessionController.adminGetProgress);
router.post(
  '/admin/:sessionId/cancel',
  adminOnly,
  cultivationSessionController.adminCancel,
);
router.post(
  '/admin/:sessionId/notifications',
  adminOrFarmOperator,
  cultivationSessionController.adminCreateNotification,
);

module.exports = router;
