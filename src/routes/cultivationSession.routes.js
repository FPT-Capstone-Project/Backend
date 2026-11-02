const express = require('express');
const cultivationSessionController = require('../controllers/cultivationSession.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];
const adminOnly = [authenticate, authorizeRoles(1)];

/**
 * @openapi
 * /api/cultivation-sessions/admin/available-trays:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: List trays currently assignable to a qualified cultivation session
 *     description: Returns AVAILABLE trays with ACTIVE positions in the same floor and room, on ACTIVE floors with no active cultivation-session assignment. Optionally filter by floorId. Read-only preview; assignment rechecks positions and mushroom compatibility under row locks.
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
 *     description: Submit floorId and trayIds explicitly. All selected trays must belong to the ACTIVE floor, with an approved matching mushroom profile and ACTIVE positions in the same room. Atomic assignment requires READY_FOR_CULTIVATION and exactly tray_quantity trays. Success starts CULTIVATING with initial progress at 0 percent.
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
 *       409: { description: 'INVALID_SESSION_STATUS, INVALID_TRAY_QUANTITY, FLOOR_NOT_ACTIVE, FLOOR_MUSHROOM_MISMATCH, TRAY_FLOOR_MISMATCH, TRAY_UNAVAILABLE, TRAY_POSITION_UNAVAILABLE, or TRAYS_ALREADY_ASSIGNED' }
 */
router.post('/admin/:sessionId/trays', adminOrFarmOperator, cultivationSessionController.adminAssignTrays);

/**
 * @openapi
 * /api/cultivation-sessions/admin/session-trays/{sessionTrayId}/inspections:
 *   post:
 *     tags: [Cultivation Audit]
 *     summary: Record a daily tray inspection
 *     description: Records tray observations only. Use the session progress API to update cultivation progress and lifecycle status.
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
 *         application/json:
 *           schema:
 *             type: object
 *             required: [growthStage, growthProgress]
 *             properties:
 *               growthStage:
 *                 type: string
 *                 enum: [FRUITING_INITIATION, PINNING, YOUNG_FRUITING, MATURATION]
 *                 example: PINNING
 *               growthProgress:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *                 example: 60
 *               trayCondition:
 *                 type: string
 *               mushroomCondition:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       201:
 *         description: Tray inspection recorded
 *       400:
 *         description: Invalid stage or inspection input
 *       404:
 *         description: Session tray not found
 *       409:
 *         description: Session tray is not active
 */
router.post(
  '/admin/session-trays/:sessionTrayId/inspections',
  adminOrFarmOperator,
  cultivationSessionController.adminCreateInspection,
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
