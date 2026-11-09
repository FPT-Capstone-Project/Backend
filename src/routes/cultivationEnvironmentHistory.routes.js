const express = require('express');
const controller = require('../controllers/cultivationEnvironmentHistory.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const allowedUsers = [authenticate, authorizeRoles(1, 2, 3)];

/**
 * @openapi
 * /api/environment-history/sessions/{sessionId}:
 *   get:
 *     tags: [Environment History]
 *     summary: Get paginated 10-minute environment averages for a cultivation session
 *     description: Reads only summarized environment history. Customers may access sessions belonging to their account; Admins and Farm Operators may access any session. The from/to range is [from, to).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Environment history and pagination }
 *       400: { description: Invalid session, date range, or pagination }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Unsupported role }
 *       404: { description: Session not found or not accessible }
 */
router.get('/sessions/:sessionId', ...allowedUsers, controller.sessionHistory);

/**
 * @openapi
 * /api/environment-history/sessions/{sessionId}/latest:
 *   get:
 *     tags: [Environment History]
 *     summary: Get the latest summarized environment record for a session
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Latest record, or null when no bucket has been saved }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Unsupported role }
 *       404: { description: Session not found or not accessible }
 */
router.get('/sessions/:sessionId/latest', ...allowedUsers, controller.latestSessionHistory);

/**
 * @openapi
 * /api/environment-history/floors/{floorId}:
 *   get:
 *     tags: [Environment History]
 *     summary: Get paginated summarized environment history for a floor
 *     description: Customer results include only records belonging to their own cultivation sessions. The from/to range is [from, to).
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: floorId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Floor environment history and pagination }
 *       400: { description: Invalid floor, date range, or pagination }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Unsupported role }
 */
router.get('/floors/:floorId', ...allowedUsers, controller.floorHistory);

module.exports = router;
