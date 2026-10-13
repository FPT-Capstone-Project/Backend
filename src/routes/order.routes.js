const express = require('express');
const orderController = require('../controllers/order.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/orders:
 *   get:
 *     tags: [Orders]
 *     summary: List orders belonging to the authenticated customer
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Customer order list
 *       401:
 *         description: Missing or invalid JWT token
 */
router.get('/', authenticate, orderController.list);

/**
 * @openapi
 * /api/orders/{orderId}/cancel:
 *   patch:
 *     tags: [Orders]
 *     summary: Cancel a pending order belonging to the authenticated customer
 *     description: Cancellation is allowed only while the order is pending and its payment status is unpaid or failed.
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
 *         description: Order cancelled successfully
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Order not found for this customer
 *       409:
 *         description: Order is not eligible for cancellation
 */
router.patch('/:orderId/cancel', authenticate, orderController.cancel);

/**
 * @openapi
 * /api/orders/{orderId}:
 *   get:
 *     tags: [Orders]
 *     summary: Get details of an order belonging to the authenticated customer
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
 *         description: Order details including its items
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Order not found for this customer
 */
router.get('/:orderId', authenticate, orderController.getById);

/**
 * @openapi
 * /api/orders/rentals:
 *   post:
 *     tags: [Orders]
 *     summary: Create an order for a rental package and mushroom type
 *     description: The authenticated customer is assigned as the order owner. The mushroom growing time must not exceed the package duration.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateRentalOrderRequest'
 *     responses:
 *       201:
 *         description: Order and rental order item created
 *       400:
 *         description: Invalid selection or mushroom growing time exceeds the rental duration
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Rental package or mushroom type not found
 */
router.post('/rentals', authenticate, orderController.create);

module.exports = router;