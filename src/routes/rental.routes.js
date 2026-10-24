const express = require('express');
const rentalController = require('../controllers/rental.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];
const adminOnly = [authenticate, authorizeRoles(1)];

/**
 * @openapi
 * /api/rentals/admin:
 *   get:
 *     tags: [Rentals]
 *     summary: List rentals managed by admin or farm operator
 *     description: Lists rental records created after successful payments. Status values are CONFIRMED, PREPARING, ACTIVE, COMPLETED, and CANCELLED. Role IDs 1 and 2 are allowed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [CONFIRMED, PREPARING, ACTIVE, COMPLETED, CANCELLED]
 *       - in: query
 *         name: userId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: packageId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: trayId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: startDateFrom
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: startDateTo
 *         schema:
 *           type: string
 *           format: date-time
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
 *         description: Rental list with pagination
 *       400:
 *         description: Invalid filter
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 */
router.get('/admin', adminOrFarmOperator, rentalController.adminList);

/**
 * @openapi
 * /api/rentals/admin/from-order:
 *   post:
 *     tags: [Rentals]
 *     summary: Manually create a rental from a paid rental order
 *     description: Creates a CONFIRMED rental if the payment webhook did not create one. The order must contain a rental package. The operation is idempotent; an existing rental is returned unchanged. Role IDs 1 and 2 are allowed.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId]
 *             properties:
 *               orderId:
 *                 type: integer
 *                 example: 15
 *     responses:
 *       201:
 *         description: Rental created
 *       200:
 *         description: Rental already exists for this order
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 *       404:
 *         description: Paid rental order not found
 *       409:
 *         description: Order has not been paid or has been cancelled
 */
router.post('/admin/from-order', adminOrFarmOperator, rentalController.adminCreateFromOrder);

/**
 * @openapi
 * /api/rentals/admin/{rentalId}/notifications:
 *   post:
 *     tags: [Notifications]
 *     summary: Send a notification to a rental customer
 *     description: Resolves the rental customer automatically and creates an unread notification. Role IDs 1 and 2 are allowed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         example: 12
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateRentalNotificationRequest'
 *           example:
 *             message: Your rental is ready for the next step.
 *             title: Rental update
 *             type: OPERATOR_MESSAGE
 *     responses:
 *       201:
 *         description: Notification sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/SentRentalNotification'
 *       400:
 *         description: Invalid rental ID or message
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 *       409:
 *         description: Rental cannot receive notifications or recipient account is inactive
 *       404:
 *         description: Rental not found
 */
router.post(
  '/admin/:rentalId/notifications',
  adminOrFarmOperator,
  rentalController.adminCreateNotification,
);

/**
 * @openapi
 * /api/rentals/admin/{rentalId}/cultivation-session:
 *   post:
 *     tags: [Rentals]
 *     summary: Start cultivation for a paid rental
 *     description: Selects the mushroom type from the rental order, creates an ACTIVE cultivation session and initial PREPARATION progress, assigns the tray, starts the rental period, marks the tray OCCUPIED, and changes a CONFIRMED order to PROCESSING. Role IDs 1 and 2 are allowed.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [trayId]
 *             properties:
 *               trayId:
 *                 type: integer
 *                 example: 8
 *     responses:
 *       201:
 *         description: Cultivation session created and rental started
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 *       404:
 *         description: Rental or cultivation tray not found
 *       409:
 *         description: Rental is not paid or ready, tray is unavailable, session already exists, or no active mushroom is associated with the rental
 */
router.post(
  '/admin/:rentalId/cultivation-session',
  adminOrFarmOperator,
  rentalController.adminStartCultivation,
);

/**
 * @openapi
 * /api/rentals/admin/{rentalId}/progress:
 *   post:
 *     tags: [Rentals]
 *     summary: Record cultivation progress for an active rental
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentStage, progressPercent]
 *             properties:
 *               currentStage:
 *                 type: string
 *                 enum: [PREPARATION, INCUBATION, PINNING, FRUITING, HARVEST]
 *               progressPercent:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 100
 *               description:
 *                 type: string
 *                 maxLength: 1000
 *           example:
 *             currentStage: PINNING
 *             progressPercent: 60
 *             description: Pinheads have appeared.
 *     responses:
 *       201:
 *         description: Progress recorded
 *       400:
 *         description: Invalid progress data
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 *       404:
 *         description: Rental not found
 *       409:
 *         description: Rental or session is not active, or progress moves backwards
 */
router.post('/admin/:rentalId/progress', adminOrFarmOperator, rentalController.adminCreateProgress);

/**
 * @openapi
 * /api/rentals/admin/{rentalId}/harvests:
 *   post:
 *     tags: [Rentals]
 *     summary: Record a harvest for an active rental
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity, unit]
 *             properties:
 *               quantity:
 *                 type: number
 *                 exclusiveMinimum: 0
 *               unit:
 *                 type: string
 *                 maxLength: 20
 *               qualityGrade:
 *                 type: string
 *                 maxLength: 20
 *               notes:
 *                 type: string
 *                 maxLength: 1000
 *               harvestDate:
 *                 type: string
 *                 format: date
 *           example:
 *             quantity: 1.5
 *             unit: kg
 *             qualityGrade: A
 *             notes: First harvest
 *             harvestDate: '2026-10-20'
 *     responses:
 *       201:
 *         description: Harvest recorded
 *       400:
 *         description: Invalid harvest data
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 *       404:
 *         description: Rental not found
 *       409:
 *         description: Rental or session is not active, or the current stage is not HARVEST
 */
router.post('/admin/:rentalId/harvests', adminOrFarmOperator, rentalController.adminCreateHarvest);

/**
 * @openapi
 * /api/rentals/admin/{rentalId}/complete:
 *   post:
 *     tags: [Rentals]
 *     summary: Complete an active rental after harvest
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               note:
 *                 type: string
 *                 maxLength: 1000
 *           example:
 *             note: Final harvest collected.
 *     responses:
 *       200:
 *         description: Rental completed
 *       400:
 *         description: Invalid completion data
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 *       404:
 *         description: Rental not found
 *       409:
 *         description: Rental or session is not active, there is no harvest, or the order is cancelled
 */
router.post('/admin/:rentalId/complete', adminOrFarmOperator, rentalController.adminComplete);

/**
 * @openapi
 * /api/rentals/admin/{rentalId}/cancel:
 *   post:
 *     tags: [Rentals]
 *     summary: Cancel a rental and mark a paid order for manual refund
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 3
 *                 maxLength: 500
 *           example:
 *             reason: Customer requested cancellation.
 *     responses:
 *       200:
 *         description: Rental cancelled
 *       400:
 *         description: Invalid cancellation reason
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin role is allowed
 *       404:
 *         description: Rental not found
 *       409:
 *         description: Rental cannot be cancelled in its current status
 */
router.post('/admin/:rentalId/cancel', adminOnly, rentalController.adminCancel);

/**
 * @openapi
 * /api/rentals/admin/{rentalId}:
 *   get:
 *     tags: [Rentals]
 *     summary: Get a rental record with customer, order, package, tray and room details
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rentalId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Rental detail
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 *       404:
 *         description: Rental not found
 */
router.get('/admin/:rentalId', adminOrFarmOperator, rentalController.adminGetById);

/**
 * @openapi
 * /api/rentals/admin/{rentalId}:
 *   patch:
 *     tags: [Rentals]
 *     summary: Update rental details or approve a confirmed rental
 *     description: PATCH only supports the CONFIRMED to PREPARING status transition. Start cultivation, complete, and cancel use their dedicated POST endpoints.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: rentalId
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
 *               status:
 *                 type: string
 *                 enum: [PREPARING]
 *               trayId:
 *                 type: integer
 *                 nullable: true
 *                 description: Set null to unassign a tray.
 *               durationDays:
 *                 type: integer
 *                 minimum: 1
 *                 description: Rental duration in days.
 *               startDate:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: Set null to clear the start timestamp.
 *               endDate:
 *                 type: string
 *                 format: date-time
 *                 nullable: true
 *                 description: Set null to clear the end timestamp.
 *     responses:
 *       200:
 *         description: Rental updated
 *       400:
 *         description: Invalid fields or rental date range
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Only Admin and Farm Operator roles are allowed
 *       404:
 *         description: Rental or available tray not found
 *       409:
 *         description: Invalid status transition or tray date conflict
 */
router.patch('/admin/:rentalId', adminOrFarmOperator, rentalController.adminUpdate);

module.exports = router;
