const express = require('express');
const paymentController = require('../controllers/payment.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/payments/orders/{orderId}/status:
 *   get:
 *     tags: [Payments]
 *     summary: Get the current PayOS payment status for an order
 *     description: Reads the authenticated customer's order and its latest PayOS payment. This endpoint never changes payment or order state.
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
 *         description: Current order and payment status
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaymentStatusResponse'
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Order or payment not found
 */
router.get('/orders/:orderId/status', authenticate, paymentController.getPayosPaymentStatus);

/**
 * @openapi
 * /api/payments/orders/{orderId}/payos/sync:
 *   post:
 *     tags: [Payments]
 *     summary: Synchronize a PayOS payment after returning from checkout
 *     description: Queries PayOS directly and updates local payment and fulfillment state only when PayOS confirms PAID. No payment status is accepted from the client.
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
 *         description: Current local payment state after synchronization
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Order or payment not found
 *       409:
 *         description: Payment could not be synchronized
 *       502:
 *         description: PayOS could not confirm the payment
 *       503:
 *         description: PayOS is not configured
 */
router.post('/orders/:orderId/payos/sync', authenticate, paymentController.syncPayosPayment);

/**
 * @openapi
 * /api/payments/orders/{orderId}/payos:
 *   post:
 *     tags: [Payments]
 *     summary: Create or reuse a PayOS payment link for an order
 *     description: Rechecks cultivation tray and spawn capacity. A link is returned only while its linked resource hold remains active.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       201:
 *         description: PayOS payment link created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PayosPaymentResponse'
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Order not found for this customer
 *       409:
 *         description: Order cannot be paid
 *       502:
 *         description: PayOS payment link could not be created
 *       503:
 *         description: PayOS is not configured
 */
router.post('/orders/:orderId/payos', authenticate, paymentController.createPayosPayment);

/**
 * @openapi
 * /api/payments/payos/webhook:
 *   get:
 *     tags: [Payments]
 *     summary: Verify that the PayOS webhook URL is reachable
 *     responses:
 *       200:
 *         description: Webhook URL is reachable
 */
router.get('/payos/webhook', paymentController.payosWebhookHealth);

/**
 * @openapi
 * /api/payments/payos/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Receive a PayOS payment webhook
 *     description: PayOS signs the data object with PAYOS_CHECKSUM_KEY. Invalid or already handled callbacks return HTTP 200 without changing payment state.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, success, data, signature]
 *             properties:
 *               code:
 *                 type: string
 *                 example: '00'
 *               desc:
 *                 type: string
 *                 example: success
 *               success:
 *                 type: boolean
 *                 example: true
 *               data:
 *                 type: object
 *                 properties:
 *                   orderCode:
 *                     type: integer
 *                     example: 34
 *                   amount:
 *                     type: integer
 *                     example: 530000
 *                   reference:
 *                     type: string
 *                     example: TF230204212323
 *                   code:
 *                     type: string
 *                     example: '00'
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: Webhook received
 */
router.post('/payos/webhook', paymentController.payosWebhook);

module.exports = router;
