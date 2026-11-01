const express = require('express');
const cultivationSessionController = require('../controllers/cultivationSession.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];
const adminOnly = [authenticate, authorizeRoles(1)];

/**
 * @openapi
 * /api/cultivation-sessions/admin:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: List paid cultivation sessions, including qualified ready-to-cultivate sessions
 *     description: Use status=READY_FOR_CULTIVATION to retrieve qualified spawn sessions with their spawn and required tray quantities before tray assignment.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, SPAWN_RESTING, MYCELIAL_DEVELOPMENT, READY_FOR_CULTIVATION, CULTIVATING, HARVESTING, COMPLETED, CANCELLED]
 *           example: READY_FOR_CULTIVATION
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: trayId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Sessions with assigned trays and latest progress
 *       400:
 *         description: Invalid filter or pagination value
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 */
router.get('/admin', adminOrFarmOperator, cultivationSessionController.adminList);

/**
 * @openapi
 * /api/cultivation-sessions/admin/available-trays:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: List trays currently assignable to a qualified cultivation session
 *     description: Returns AVAILABLE trays on ACTIVE floors with no active cultivation-session assignment. Optionally filter to a Farm Operator-selected floor. This is a read-only preview; POST tray assignment rechecks availability under row locks.
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
 *       200: { description: "Session detail including status, harvest status, mushroom, trays, and latest progress" }
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
 *     summary: Assign Farm Operator-selected trays on one floor to a qualified session
 *     description: Farm Operator selects a cultivation floor and specific available trays for a session whose spawn passed WF-02 qualification. The backend validates and atomically assigns only the selected trays; this action does not activate cultivation.
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
 *         description: Selected trays assigned without activating the session
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
 *       409: { description: Invalid session status, incorrect tray count, wrong floor, unavailable tray, or existing assignment }
 */
router.post('/admin/:sessionId/trays', adminOrFarmOperator, cultivationSessionController.adminAssignTrays);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/activate:
 *   post:
 *     tags: [Cultivation Sessions]
 *     summary: Activate a qualified session after all required trays are assigned
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Session is CULTIVATING with FRUITING_INITIATION progress }
 *       400: { description: Invalid session ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session not found }
 *       409: { description: Invalid session status or required trays are missing }
 */
router.post('/admin/:sessionId/activate', adminOrFarmOperator, cultivationSessionController.adminActivate);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/harvest-ready:
 *   post:
 *     tags: [Cultivation Sessions]
 *     summary: Mark a mature cultivation session ready for the separate harvesting workflow
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Session remains CULTIVATING and harvest_status becomes HARVEST_READY }
 *       400: { description: Invalid session ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session not found }
 *       409: { description: Session is not mature or is already harvest ready }
 */
router.post(
  '/admin/:sessionId/harvest-ready',
  adminOrFarmOperator,
  cultivationSessionController.adminMarkHarvestReady,
);

/**
 * @openapi
 * /api/cultivation-sessions/admin/session-trays/{sessionTrayId}/inspections:
 *   post:
 *     tags: [Cultivation Sessions]
 *     summary: Record a daily inspection and update session progress
 *     description: Creates a cultivation_inspections record for the assigned tray and appends the corresponding cultivation_progress record.
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
 *         description: Inspection and progress history recorded
 *       400:
 *         description: Invalid stage or inspection input
 *       404:
 *         description: Session tray not found
 *       409:
 *         description: Session tray is not active or progress moved backwards
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
 *     tags: [Cultivation Sessions]
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
 *     tags: [Cultivation Sessions]
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
 *     tags: [Cultivation Sessions]
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

router.post(
  '/admin/session-trays/:sessionTrayId/harvests',
  adminOrFarmOperator,
  cultivationSessionController.adminCreateHarvest,
);
/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/progress:
 *   post:
 *     tags: [Cultivation Sessions]
 *     summary: Append a validated WF-03 growth-stage progress record
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
 *             required: [currentStage, progressPercent]
 *             properties:
 *               currentStage: { type: string, enum: [FRUITING_INITIATION, PINNING, YOUNG_FRUITING, MATURATION] }
 *               progressPercent: { type: number, minimum: 0, maximum: 100 }
 *               description: { type: string }
 *     responses:
 *       201: { description: Progress recorded }
 *       400: { description: Invalid request input }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Session not found }
 *       409: { description: Invalid session state or stage transition }
 */
router.post(
  '/admin/:sessionId/progress',
  adminOrFarmOperator,
  cultivationSessionController.adminCreateProgress,
);

/**
 * @openapi
 * /api/cultivation-sessions/admin/{sessionId}/progress:
 *   get:
 *     tags: [Cultivation Sessions]
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
  '/admin/:sessionId/complete',
  adminOrFarmOperator,
  cultivationSessionController.adminComplete,
);
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
