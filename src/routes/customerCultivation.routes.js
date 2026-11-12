const express = require('express');
const spawnInspectionController = require('../controllers/spawnInspection.controller');
const diseaseManagementController = require('../controllers/diseaseManagement.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/customer/orders/{orderId}/cultivation-status:
 *   get:
 *     tags: [Farm Spawn Workflow]
 *     summary: View cultivation sessions for an owned order, or any order as an admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *          description: Customer-visible session status, harvest readiness, latest growth progress, assigned trays, and receiving method/status/schedule when selected
 *       404:
 *         description: Order not found or not accessible to this user
 */
router.get(
  '/orders/:orderId/cultivation-status',
  authenticate,
  spawnInspectionController.customerCultivationStatus,
);

/**
 * @openapi
 * /api/customer/orders/{orderId}/cultivation-progress:
 *   get:
 *     tags: [Farm Spawn Workflow]
 *     summary: View cultivation stage history for an owned order, or any order as an admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Stage timeline
 *       404:
 *         description: Order not found or not accessible to this user
 */
router.get(
  '/orders/:orderId/cultivation-progress',
  authenticate,
  spawnInspectionController.customerCultivationProgress,
);
router.get(
  '/orders/:orderId/spawn-inspections',
  authenticate,
  spawnInspectionController.customerSpawnInspections,
);

/**
 * @openapi
 * /api/customer/orders/{orderId}/spawn-inspections:
 *   get:
 *     tags: [Farm Spawn Workflow]
 *     summary: View spawn inspection history for an owned order, or any order as an admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Inspection history and image URLs
 *       404:
 *         description: Order not found or not accessible to this user
 */
router.get(
  '/orders/:orderId/spawn-inspections/:inspectionId',
  authenticate,
  spawnInspectionController.customerSpawnInspection,
);

router.get(
  '/sessions/:sessionId/issues',
  authenticate,
  diseaseManagementController.customerSessionIssues,
);
router.get(
  '/issues/:issueId',
  authenticate,
  diseaseManagementController.customerIssue,
);
router.get(
  '/issues/:issueId/timeline',
  authenticate,
  diseaseManagementController.customerIssueTimeline,
);

/**
 * @openapi
 * /api/customer/orders/{orderId}/spawn-inspections/{inspectionId}:
 *   get:
 *     tags: [Farm Spawn Workflow]
 *     summary: View one spawn inspection for an owned order, or any order as an admin
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: path
 *         name: inspectionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Inspection details and image URLs
 *       404:
 *         description: Inspection not found for this order or not accessible to this user
 */

module.exports = router;
