const express = require('express');
const notificationController = require('../controllers/notification.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/notifications/{notificationId}/confirm-repair:
 *   patch:
 *     tags: [Notifications]
 *     summary: Legacy compatibility endpoint for automatic device recovery
 *     deprecated: true
 *     description: All device types recover automatically with fresh live evidence. This endpoint runs the same recovery check for legacy clients; repairNote is ignored. GET notifications returns auto_resolved and can_confirm_repair=false. Repeated calls do not duplicate notifications.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               repairNote: { type: string, maxLength: 1000 }
 *     responses:
 *       200: { description: Recovery confirmed automatically; active staff and original recipients notified once }
 *       400: { description: Invalid ID or repair note }
 *       401: { description: Authentication required }
 *       403: { description: Farm Operator only }
 *       404: { description: Device notification not owned by current operator }
 *       409: { description: Device has not recovered }
 */
router.patch('/:notificationId/confirm-repair', authenticate, authorizeRoles(2), notificationController.confirmDeviceRepair);

/**
 * @openapi
 * /api/notifications/cultivation-sessions/{sessionId}:
 *   post:
 *     tags: [Notifications]
 *     summary: Send a notification to the Customer who owns a cultivation session
 *     description: Admin (1) and Farm Operator (2) only. The backend identifies the active Customer (3) through the session's order. Recipient, creator, and reference fields are set by the backend; caller-supplied values are ignored.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         description: ID of the cultivation session whose Customer should receive the notification.
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, message]
 *             properties:
 *               title:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *                 description: Required title; trimmed and must not be blank.
 *               message:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 1000
 *                 description: Required message; trimmed and must not be blank.
 *               type:
 *                 type: string
 *                 enum: [OPERATOR_MESSAGE, MUSHROOM_DISEASE, DEVICE_ISSUE]
 *                 default: OPERATOR_MESSAGE
 *                 description: Optional notification type; trimmed and normalized to uppercase.
 *           example:
 *             title: Thông báo về quá trình trồng nấm
 *             message: Farm Operator muốn cập nhật tình trạng trồng nấm của bạn.
 *             type: OPERATOR_MESSAGE
 *     responses:
 *       201:
 *         description: Notification saved for the session's Customer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string, example: Notification sent successfully }
 *                 data:
 *                   $ref: '#/components/schemas/SentCultivationNotification'
 *             example:
 *               message: Notification sent successfully
 *               data:
 *                 notification_id: 21
 *                 user_id: 8
 *                 notification_type: OPERATOR_MESSAGE
 *                 title: Thông báo về quá trình trồng nấm
 *                 message: Farm Operator muốn cập nhật tình trạng trồng nấm của bạn.
 *                 reference_type: CULTIVATION_SESSION
 *                 reference_id: 17
 *                 created_at: '2026-11-04T14:30:00.000Z'
 *       400:
 *         description: Invalid session ID, title, message, type, or request body
 *       401:
 *         description: Missing or invalid JWT
 *       403:
 *         description: Only Admin (1) and Farm Operator (2) may send notifications
 *       404:
 *         description: Session or Customer recipient not found
 *       409:
 *         description: Session is ineligible (completed or cancelled) or Customer account is inactive
 *       500:
 *         description: Internal server error
 */
router.post(
  '/cultivation-sessions/:sessionId',
  authenticate,
  authorizeRoles(1, 2),
  notificationController.sendCultivationSessionNotification,
);

/**
 * @openapi
 * /api/notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List the current user's notifications
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: isRead
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *       - in: query
 *         name: pageSize
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *     responses:
 *       200:
 *         description: Notifications and unread count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Notification'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *                 meta:
 *                   type: object
 *                   properties:
 *                     unread_count: { type: integer, minimum: 0 }
 *       400:
 *         description: Invalid isRead, page, or pageSize
 *       401:
 *         description: Missing or invalid JWT token
 */
router.get('/', authenticate, notificationController.list);

/**
 * @openapi
 * /api/notifications/read-all:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark all current-user notifications as read
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notifications marked as read
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     updated: { type: integer, minimum: 0 }
 *       401:
 *         description: Missing or invalid JWT token
 */
router.patch('/read-all', authenticate, notificationController.markAllRead);

/**
 * @openapi
 * /api/notifications/{notificationId}/read:
 *   patch:
 *     tags: [Notifications]
 *     summary: Mark one current-user notification as read
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: notificationId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       200:
 *         description: Notification marked as read
 *       400:
 *         description: Invalid notification ID
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Notification not found
 */
router.patch('/:notificationId/read', authenticate, notificationController.markRead);

module.exports = router;
