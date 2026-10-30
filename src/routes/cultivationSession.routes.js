const express = require('express');
const cultivationSessionController = require('../controllers/cultivationSession.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];
const adminOnly = [authenticate, authorizeRoles(1)];

/**
 * @openapi
 * /api/cultivation-sessions/admin:
 *   get:
 *     tags: [Cultivation Sessions]
 *     summary: List paid cultivation sessions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PLANNED, ACTIVE, COMPLETED, CANCELLED]
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
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 */
router.get('/admin', adminOrFarmOperator, cultivationSessionController.adminList);
router.get('/admin/:sessionId', adminOrFarmOperator, cultivationSessionController.adminGetById);

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
 *                 example: FRUITING
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

router.post(
  '/admin/session-trays/:sessionTrayId/harvests',
  adminOrFarmOperator,
  cultivationSessionController.adminCreateHarvest,
);
router.post(
  '/admin/:sessionId/progress',
  adminOrFarmOperator,
  cultivationSessionController.adminCreateProgress,
);
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
