const express = require('express');
const shipmentController = require('../controllers/shipment.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];

/**
 * @openapi
 * /api/shipments:
 *   post:
 *     tags: [Shipments]
 *     summary: Manually create a shipment for Admin and Farm Operators
 *     description: A shipment is created or reused by order when a DELIVERY harvest request is created. Use this endpoint only to create a shipment manually when the order has no active shipment. The new shipment starts in PENDING and is linked to the order by orderId.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [orderId, address, recipientName, recipientPhone]
 *             properties:
 *               orderId: { type: integer, minimum: 1 }
 *               address: { type: string, minLength: 1 }
 *               recipientName: { type: string, minLength: 1, maxLength: 150 }
 *               recipientPhone: { type: string, minLength: 1, maxLength: 30 }
 *               shippingFee: { type: number, minimum: 0, maximum: 9999999999.99, default: 0 }
 *               carrier: { type: string, maxLength: 100 }
 *               trackingCode: { type: string, maxLength: 150 }
 *     responses:
 *       201: { description: Shipment created in PENDING status }
 *       400: { description: Invalid or missing shipment data }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Order not found }
 *       409: { description: An active shipment already exists for the order }
 */
router.post('/', adminOrFarmOperator, shipmentController.create);

/**
 * @openapi
 * /api/shipments/admin:
 *   get:
 *     tags: [Shipments]
 *     summary: List shipments for Admin and Farm Operators
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Shipment list with order, customer, address, carrier, tracking code and status }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 */
router.get('/admin', adminOrFarmOperator, shipmentController.adminList);

/**
 * @openapi
 * /api/shipments/orders/{orderId}:
 *   get:
 *     tags: [Shipments]
 *     summary: Get shipment status for one order
 *     description: Customers may view shipments for their own order. Admins and Farm Operators may view any order. An order without shipments returns an empty data array.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Shipments for the order }
 *       400: { description: Invalid order ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Authenticated user role is not permitted }
 *       404: { description: Order not found for this customer }
 */
router.get(
  '/orders/:orderId',
  authenticate,
  authorizeRoles(1, 2, 3),
  shipmentController.orderList,
);

/**
 * @openapi
 * /api/shipments/{id}/details:
 *   patch:
 *     tags: [Shipments]
 *     summary: Update shipment details without changing its status
 *     description: Admins and Farm Operators may update carrier, tracking code, shipping fee, and handoff time. Delivery time may be changed after delivery.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [carrier, trackingCode, shippingFee, shippedAt]
 *             properties:
 *               carrier: { type: string, maxLength: 100, nullable: true }
 *               trackingCode: { type: string, maxLength: 150, nullable: true }
 *               shippingFee: { type: number, minimum: 0, maximum: 9999999999.99 }
 *               shippedAt: { type: string, format: date-time, nullable: true }
 *               deliveredAt: { type: string, format: date-time, nullable: true }
 *     responses:
 *       200: { description: Shipment details updated without changing status }
 *       400: { description: Invalid shipment details or timestamp order }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Shipment not found }
 *       409: { description: Delivery time cannot be changed before delivery }
 */
router.patch('/:id/details', adminOrFarmOperator, shipmentController.updateDetails);

/**
 * @openapi
 * /api/shipments/{id}/status:
 *   patch:
 *     tags: [Shipments]
 *     summary: Update a shipment status for Admin and Farm Operators
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [PENDING, SHIPPED, IN_TRANSIT, DELIVERED, CANCELLED, RETURNED] }
 *               deliveredAt: { type: string, format: date-time, description: Optional delivery confirmation time. }
 *     responses:
 *       200: { description: Shipment status updated }
 *       400: { description: Invalid shipment ID or status }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Shipment not found }
 */
router.patch('/:id/status', adminOrFarmOperator, shipmentController.updateStatus);

module.exports = router;
