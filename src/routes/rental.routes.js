const express = require('express');
const rentalController = require('../controllers/rental.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];

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
 * /api/rentals/admin/{rentalId}/cultivation-session:
 *   post:
 *     tags: [Rentals]
 *     summary: Start cultivation for a paid rental
 *     description: Selects the mushroom type from the rental order, creates an ACTIVE cultivation session, assigns the tray, starts the rental period, and marks the tray OCCUPIED. The order remains CONFIRMED and its payment remains PAID. Role IDs 1 and 2 are allowed.
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
 *     summary: Update rental fields or change its status
 *     description: Status transitions are CONFIRMED to PREPARING or CANCELLED, PREPARING to ACTIVE or CANCELLED, and ACTIVE to COMPLETED or CANCELLED. Activation requires a paid order and an available tray. Cancelling a rental does not automatically refund the order.
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
 *                 enum: [PREPARING, ACTIVE, COMPLETED, CANCELLED]
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
