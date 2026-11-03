const express = require('express');
const analyticsController = require('../controllers/analytics.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/analytics/dashboard:
 *   get:
 *     tags: [Analytics]
 *     summary: Get all-time dashboard revenue, tray usages and harvest quality percentages
 *     description: 'Roles: 1 = Admin, 2 = Farm Operator, 3 = Customer. Only roles 1 and 2 may access. Revenue sums orders.total_amount where orders.payment_status is PAID, regardless of order status. Trays count ACTIVE or RELEASED assignments in CULTIVATING, HARVEST_READY, HARVESTING or COMPLETED sessions; cancelled and pre-cultivation sessions are excluded. Repeated use of a physical tray counts each assignment. Harvest quality includes COMPLETED harvests with all three weights present and nonnegative. usable_rate = usable harvested weight / total harvested weight × 100; waste_rate = rejected harvested weight / total harvested weight × 100. Rates are percentages rounded to at most two decimals, without normalization to 100. Empty metrics and rates with zero total weight return 0. No date filter.'
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Dashboard metrics (quality rates are percentages)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [data]
 *               properties:
 *                 data:
 *                   type: object
 *                   required: [revenue, trays_used, harvest_quality]
 *                   properties:
 *                     revenue:
 *                       type: object
 *                       required: [value, currency]
 *                       properties:
 *                         value: { type: number, example: 128500000 }
 *                         currency: { type: string, enum: [VND] }
 *                     trays_used: { type: integer, example: 36 }
 *                     harvest_quality:
 *                       type: object
 *                       required: [usable_rate, waste_rate]
 *                       properties:
 *                         usable_rate: { type: number, description: Percentage of total harvested weight that is usable, example: 93 }
 *                         waste_rate: { type: number, description: Percentage of total harvested weight that is rejected, example: 7 }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 */
router.get('/dashboard', authenticate, authorizeRoles(1, 2), analyticsController.dashboard);

module.exports = router;
