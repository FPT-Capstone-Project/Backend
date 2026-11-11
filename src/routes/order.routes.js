const express = require('express');
const orderController = require('../controllers/order.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];

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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     description: One record per order, retaining all existing order fields. Names are joined with commas in item ID order; total_price sums item totals. Item summary fields are null for orders without items.
 *                     properties:
 *                       order_id: { type: integer }
 *                       user_id: { type: integer }
 *                       subtotal: { type: string }
 *                       discount: { type: string }
 *                       shipping_fee: { type: string }
 *                       total_amount: { type: string }
 *                       status: { type: string }
 *                       payment_status: { type: string, description: Current orders.payment_status }
 *                       created_at: { type: string, format: date-time }
 *                       updated_at: { type: string, format: date-time }
 *                       package_name: { type: string, nullable: true }
 *                       mushroom_name: { type: string, nullable: true }
 *                       total_price: { type: string, nullable: true }
 *       401:
 *         description: Missing or invalid JWT token
 */
router.get('/', authenticate, orderController.list);

/**
 * @openapi
 * /api/orders/admin:
 *   get:
 *     tags: [Orders]
 *     summary: List orders from all customers for Admin and Farm Operator
 *     description: 'Roles: 1 = Admin, 2 = Farm Operator, 3 = Customer. Only roles 1 and 2 may access. One record per order; names are comma-separated in item ID order, quantity and total_price sum all items. Item summaries are null without items. Payment status comes from orders.payment_status. No synthetic order_code is generated.'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1, default: 1 }
 *       - in: query
 *         name: pageSize
 *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
 *     responses:
 *       200:
 *         description: Customer orders with pagination, newest first with order ID as tie breaker
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       order_id: { type: integer }
 *                       customer_id: { type: integer }
 *                       customer_name: { type: string, nullable: true }
 *                       customer_email: { type: string, nullable: true }
 *                       package_name: { type: string, nullable: true }
 *                       mushroom_name: { type: string, nullable: true }
 *                       quantity: { type: integer, nullable: true, description: Sum of item quantities }
 *                       total_price: { type: string, nullable: true }
 *                       subtotal: { type: string }
 *                       discount: { type: string }
 *                       shipping_fee: { type: string }
 *                       total_amount: { type: string }
 *                       status: { type: string }
 *                       payment_status: { type: string }
 *                       created_at: { type: string, format: date-time }
 *                       updated_at: { type: string, format: date-time }
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page: { type: integer }
 *                     pageSize: { type: integer }
 *                     total: { type: integer }
 *                     totalPages: { type: integer }
 *       400: { description: Invalid pagination }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 */
router.get('/admin', adminOrFarmOperator, orderController.adminList);

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
 * /api/orders/{orderId}/harvest-history:
 *   get:
 *     tags: [Harvests]
 *     summary: Trace cultivation sessions, mushroom types, harvests, yield, and receiving method for an order
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: orderId
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Order harvest history }
 *       400: { description: Invalid order ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Order not found }
 */
router.get('/:orderId/harvest-history', adminOrFarmOperator, orderController.harvestHistory);

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
 *     description: The selected active package must cover the selected active mushroom's growing days. One ACTIVE floor with an approved matching mushroom profile must have enough AVAILABLE trays with ACTIVE positions in the same floor and room, after unexpired HELD reservations. Capacity is never combined across floors. Each tray requires two spawn units. Reservations are consumed after successful payment; Farm Operator selects physical trays later in WF-03.
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
