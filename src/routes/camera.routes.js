const express = require('express');
const cameraController = require('../controllers/camera.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const adminOnly = [authenticate, authorizeRoles(1)];
const authenticated = [authenticate];

/**
 * @openapi
 * /api/cameras:
 *   get:
 *     tags: [Cameras]
 *     summary: List cameras
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: roomId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE, OFFLINE]
 *     responses:
 *       200:
 *         description: Camera list
 *       403:
 *         description: Administrator access required
 */
router.get('/', ...adminOnly, cameraController.list);

/**
 * @openapi
 * /api/cameras:
 *   post:
 *     tags: [Cameras]
 *     summary: Register an Imou camera
 *     description: cameraCode stores the Imou device ID used by the live-stream endpoint.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [roomId, cameraCode, cameraName]
 *             properties:
 *               roomId:
 *                 type: integer
 *               cameraCode:
 *                 type: string
 *                 description: Imou cloud device ID
 *               cameraName:
 *                 type: string
 *               streamUrl:
 *                 type: string
 *                 nullable: true
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE, OFFLINE]
 *     responses:
 *       201:
 *         description: Camera created successfully
 *       400:
 *         description: Invalid camera data
 *       403:
 *         description: Administrator access required
 *       409:
 *         description: cameraCode already exists
 */
router.post('/', ...adminOnly, cameraController.create);

/**
 * @openapi
 * /api/cameras/live-streams:
 *   get:
 *     tags: [Cameras]
 *     summary: List current Imou live sessions
 *     description: Reads live sessions created under the configured Imou Open Platform application. Only administrators can access live tokens needed to stop a session.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: start
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         description: Page size, from 1 to 50
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Current live sessions
 *       502:
 *          description: Imou cloud request failed
 */
router.get('/live-streams', ...adminOnly, cameraController.listLiveStreams);

/**
 * @openapi
 * /api/cameras/live-streams/stop:
 *   post:
 *     tags: [Cameras]
 *     summary: Stop an Imou live session
 *     description: Uses liveToken returned by GET /api/cameras/live-streams. Only administrators can manage Imou sessions.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [liveToken]
 *             properties:
 *               liveToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Live session stopped
 *       400:
 *         description: liveToken is required
 *       502:
 *         description: Imou cloud request failed
 */
router.post('/live-streams/stop', ...adminOnly, cameraController.stopLiveSession);

/**
 * @openapi
 * /api/cameras/{cameraId}/imou-player-token:
 *   get:
 *     tags: [Cameras]
 *     summary: Get a scoped Imou KitToken for ImouPlayer
 *     description: Returns a short-lived KitToken for live preview. The Imou App Secret and Open Platform access token are never exposed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: channelId
 *         schema:
 *           type: string
 *           default: "0"
 *       - in: query
 *         name: streamId
 *         description: ImouPlayer stream ID (0 or 1)
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *           default: 0
 *     responses:
 *       200:
 *         description: ImouPlayer configuration and KitToken
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Camera not found
 *       409:
 *         description: Camera is not active or has no Imou device ID configured
 *       502:
 *         description: Imou cloud request failed
 *       503:
 *         description: Imou cloud credentials are not configured
 */
router.get(
  '/:cameraId/imou-player-token',
  ...authenticated,
  cameraController.getImouPlayerToken,
);

/**
 * @openapi
 * /api/cameras/{cameraId}:
 *   get:
 *     tags: [Cameras]
 *     summary: Get camera details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Camera details
 *       404:
 *         description: Camera not found
 */
router.get('/:cameraId', ...adminOnly, cameraController.getById);

/**
 * @openapi
 * /api/cameras/{cameraId}:
 *   put:
 *     tags: [Cameras]
 *     summary: Update camera details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               roomId:
 *                 type: integer
 *               cameraCode:
 *                 type: string
 *               cameraName:
 *                 type: string
 *               streamUrl:
 *                 type: string
 *                 nullable: true
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE, OFFLINE]
 *     responses:
 *       200:
 *         description: Camera updated successfully
 *       400:
 *         description: Invalid camera data
 *       404:
 *         description: Camera or room not found
 *       409:
 *         description: cameraCode already exists
 */
router.put('/:cameraId', ...adminOnly, cameraController.update);

/**
 * @openapi
 * /api/cameras/{cameraId}:
 *   delete:
 *     tags: [Cameras]
 *     summary: Delete a camera
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Camera deleted successfully
 *       404:
 *         description: Camera not found
 *       409:
 *         description: Camera is referenced by another record
 */
router.delete('/:cameraId', ...adminOnly, cameraController.remove);

/**
 * @openapi
 * /api/cameras/live-streams:
 *   get:
 *     tags: [Cameras]
 *     summary: List current Imou live sessions for registered cameras
 *     description: Reads current stream information without starting a new session. HLS URLs are temporary and live tokens are never returned.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cameraId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: roomId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: channelIds
 *         description: Comma-separated Imou channel IDs. Defaults to 0.
 *         schema:
 *           type: string
 *           example: "0,1"
 *     responses:
 *       200:
 *         description: Current live sessions
 *       502:
 *         description: Imou cloud request failed
 */
/**
 * @openapi
 * /api/cameras/{cameraId}/live-stream:
 *   get:
 *     tags: [Cameras]
 *     summary: Get a temporary Imou cloud live-stream link
 *     description: The camera's camera_code must contain its Imou cloud device ID. Any authenticated user can view the stream.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: channelId
 *         required: false
 *         description: Imou device channel; defaults to 0
 *         schema:
 *           type: string
 *           default: "0"
 *       - in: query
 *         name: streamId
 *         required: false
 *         description: Imou stream ID; defaults to 0
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *           default: 0
 *     responses:
 *       200:
 *         description: Temporary stream information returned by Imou
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Camera not found
 *       502:
 *         description: Imou cloud request failed
 *       503:
 *         description: Imou cloud credentials are not configured
 */
router.get(
  '/:cameraId/live-stream',
  ...authenticated,
  cameraController.getLiveStream,
);

/**
 * @openapi
 * /api/cameras/{cameraId}/live-stream:
 *   post:
 *     tags: [Cameras]
 *     summary: Start or retrieve an Imou cloud live stream
 *     description: Any authenticated user can start or retrieve the stream for viewing.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: channelId
 *         schema:
 *           type: string
 *           default: "0"
 *       - in: query
 *         name: streamId
 *         schema:
 *           type: integer
 *           enum: [0, 1]
 *           default: 0
 *     responses:
 *       200:
 *         description: Live stream URL
 *       409:
 *         description: Camera is not active
 *       502:
 *         description: Imou cloud request failed
 */
router.post(
  '/:cameraId/live-stream',
  ...authenticated,
  cameraController.getLiveStream,
);

/**
 * @openapi
 * /api/cameras/{cameraId}/live-stream/stop:
 *   post:
 *     tags: [Cameras]
 *     summary: Stop an Imou live session for a camera channel
 *     description: Ends the cloud live session using its live token. This does not change local camera status.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: cameraId
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: channelId
 *         schema:
 *           type: string
 *           default: "0"
 *     responses:
 *       200:
 *         description: Session stopped or no active session exists
 *       403:
 *         description: Administrator access required
 *       502:
 *         description: Imou cloud request failed
 */
router.post(
  '/:cameraId/live-stream/stop',
  ...adminOnly,
  cameraController.stopLiveStream,
);

module.exports = router;
