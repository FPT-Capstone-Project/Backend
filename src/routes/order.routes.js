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
 *     description: Cancellation is allowed only while the order is pending and its payment status is unpaid, pending, or failed. Pending payments are cancelled and the order payment status becomes failed.
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
 * /api/orders/cultivation:
 *   post:
 *     tags: [Orders]
 *     summary: Create a cultivation order for a mushroom type, package, and tray quantity
 *     description: The selected active package must cover the selected mushroom's growing days. Each tray requires three spawn units. Both trays and spawn are held for the configured checkout period and allocated only after successful payment.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCultivationOrderRequest'
 *     responses:
 *       201:
 *         description: Order and cultivation order item created
 *       400:
 *         description: Invalid selection or mushroom growing time exceeds the selected package duration
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Package or mushroom type not found
 *       409:
 *         description: Insufficient cultivation capacity (`INSUFFICIENT_TRAYS` or `INSUFFICIENT_SPAWN`)
 */
router.post('/cultivation', authenticate, orderController.create);

module.exports = router;
