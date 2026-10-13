const express = require('express');
const paymentController = require('../controllers/payment.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/payments/orders/{orderId}/sepay-qr:
 *   post:
 *     tags: [Payments]
 *     summary: Create or reuse a SePay QR payment for an order
 *     description: The authenticated customer must own a pending unpaid order. The response contains a PNG QR URL to display in the client.
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
 *         description: SePay QR payment created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SepayQrPaymentResponse'
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Order not found for this customer
 *       409:
 *         description: Order cannot be paid
 *       503:
 *         description: SePay QR is not configured
 */
router.post('/orders/:orderId/sepay-qr', authenticate, paymentController.createSepayQr);

/**
 * @openapi
 * /api/payments/sepay/webhook:
 *   post:
 *     tags: [Payments]
 *     summary: Receive a signed SePay money-in notification
 *     parameters:
 *       - in: header
 *         name: X-SePay-Signature
 *         required: true
 *         schema:
 *           type: string
 *       - in: header
 *         name: X-SePay-Timestamp
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [accountNumber, content, transferType, transferAmount]
 *             properties:
 *               accountNumber:
 *                 type: string
 *                 example: '0123456789'
 *               content:
 *                 type: string
 *                 example: SP12P34
 *               transferType:
 *                 type: string
 *                 example: in
 *               transferAmount:
 *                 type: integer
 *                 example: 530000
 *     responses:
 *       200:
 *         description: Webhook accepted
 */
router.post('/sepay/webhook', paymentController.sepayWebhook);

module.exports = router;
