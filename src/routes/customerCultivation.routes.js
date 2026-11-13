const express = require('express');
const spawnInspectionController = require('../controllers/spawnInspection.controller');
const diseaseManagementController = require('../controllers/diseaseManagement.controller');
const customerIotHistoryController = require('../controllers/customerIotHistory.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const customerHistoryAccess = [authenticate, authorizeRoles(1, 2, 3)];

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
/**
 * @openapi
 * /api/customer/sessions/{sessionId}/iot-history/sensors:
 *   get:
 *     tags: [Customer Cultivation]
 *     summary: Get sensor readings recorded while the customer's session occupied its assigned floor
 *     description: Customers may access their own session; Admins and Farm Operators may access any session. Readings are scoped to the floor assignment and session period.
 *     security: [{ bearerAuth: [] }]
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
 *       200: { description: Sensor readings with sensor, floor, validity, and timestamp fields }
 *       400: { description: Invalid session ID or pagination }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Unsupported role }
 *       404: { description: Session not found or not accessible }
 */
router.get(
  '/sessions/:sessionId/iot-history/sensors',
  ...customerHistoryAccess,
  customerIotHistoryController.sensorHistory,
);
/**
 * @openapi
 * /api/customer/sessions/{sessionId}/iot-history:
 *   get:
 *     tags: [Customer Cultivation]
 *     summary: Get device command history for the customer's cultivation session
 *     description: Customers may access their own session; Admins and Farm Operators may access any session. Commands are scoped to devices mapped to the assigned floor during the session period.
 *     security: [{ bearerAuth: [] }]
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
 *       200: { description: Device command events and mapped floors }
 *       400: { description: Invalid session ID or pagination }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Unsupported role }
 *       404: { description: Session not found or not accessible }
 */
router.get(
  '/sessions/:sessionId/iot-history',
  ...customerHistoryAccess,
  customerIotHistoryController.deviceHistory,
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
