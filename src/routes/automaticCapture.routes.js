const express = require('express');
const controller = require('../controllers/automaticCapture.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const staffOnly = [authenticate, authorizeRoles(1, 2)];

/**
 * @openapi
 * /api/automatic-captures/test:
 *   post:
 *     tags: [Automatic Captures]
 *     summary: Capture a test image and create automatic inspections for active trays
 *     description: Captures and uploads one image, creates a capture log, then associates that same image with each active occupied tray on the camera's floor. Image capture failures are logged with status FAILED; inspection failures retain the uploaded image and are reported in the capture log.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cameraId]
 *             properties:
 *               cameraId: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Capture result and per-tray totals }
 *       400: { description: Invalid or missing camera ID }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Admin or Farm Operator access required }
 *       404: { description: Camera not found }
 *       409: { description: Camera is not active }
 *       502: { description: Camera or Cloudinary capture failed; a FAILED log is stored }
 *       503: { description: Camera integration is not configured }
 */
router.post('/test', ...staffOnly, controller.testCapture);

/**
 * @openapi
 * /api/automatic-captures/cameras/{cameraId}/trays:
 *   get:
 *     tags: [Automatic Captures]
 *     summary: List trays currently assigned to cultivation sessions on a camera's floor
 *     description: Returns trays on the camera's floor that have an ACTIVE cultivation session-tray assignment, including tray status, position, and cultivation session status. Returns an empty list when the camera has no floor or no trays are currently assigned.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Camera floor and its trays }
 *       400: { description: Invalid camera ID }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Admin or Farm Operator access required }
 *       404: { description: Camera not found }
 */
router.get('/cameras/:cameraId/trays', ...staffOnly, controller.getCameraTrays);

/**
 * @openapi
 * /api/automatic-captures/configs:
 *   get:
 *     tags: [Automatic Captures]
 *     summary: List capture configurations for all cameras
 *     description: Returns all cameras, including cameras that do not have a capture configuration yet.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Camera capture configurations }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Admin or Farm Operator access required }
 */
router.get('/configs', ...staffOnly, controller.listConfigs);

/**
 * @openapi
 * /api/automatic-captures/cameras/{cameraId}/config:
 *   get:
 *     tags: [Automatic Captures]
 *     summary: Get the capture configuration for one active camera
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Camera and capture configuration, with config_id null when not configured }
 *       400: { description: Invalid camera ID }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Admin or Farm Operator access required }
 *       404: { description: Camera not found }
 *       409: { description: Camera is not active }
 *   put:
 *     tags: [Automatic Captures]
 *     summary: Create or update an active camera's capture configuration
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [captureTimes, isEnabled]
 *             properties:
 *               captureTimes:
 *                 type: array
 *                 minItems: 1
 *                 items: { type: string, pattern: '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$' }
 *                 example: ['08:00', '14:30']
 *               isEnabled: { type: boolean }
 *     responses:
 *       200: { description: Capture configuration saved }
 *       400: { description: Invalid camera ID, time format, duplicate time, or request fields }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Admin or Farm Operator access required }
 *       404: { description: Camera not found }
 *       409: { description: Camera is not active }
 */
router.get('/cameras/:cameraId/config', ...staffOnly, controller.getConfig);
router.put('/cameras/:cameraId/config', ...staffOnly, controller.updateConfig);

/**
 * @openapi
 * /api/automatic-captures/logs:
 *   get:
 *     tags: [Automatic Captures]
 *     summary: List paginated automatic capture history
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: cameraId
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PROCESSING, SUCCESS, PARTIAL_SUCCESS, FAILED] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200: { description: Capture logs and pagination metadata }
 *       400: { description: Invalid filters or pagination }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Admin or Farm Operator access required }
 *       404: { description: Camera not found }
 */
router.get('/logs', ...staffOnly, controller.listLogs);

/**
 * @openapi
 * /api/automatic-captures/logs/{logId}:
 *   get:
 *     tags: [Automatic Captures]
 *     summary: Get details of one automatic capture
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: logId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Capture log and camera details }
 *       400: { description: Invalid log ID }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Admin or Farm Operator access required }
 *       404: { description: Capture log not found }
 */
router.get('/logs/:logId', ...staffOnly, controller.getLog);

module.exports = router;
