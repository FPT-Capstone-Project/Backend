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

/**
 * @openapi
 * /api/analytics/dashboard/environment-history:
 *   get:
 *     tags: [Analytics]
 *     summary: Chart-ready temperature and humidity history for every active floor
 *     description: 'Reads only cultivation_environment_history, never raw sensor readings. Default window is 24h ending at the latest 5-minute boundary, with chart points grouped into 96 15-minute buckets from stored 10-minute session/floor averages. Custom from/to must be supplied together, with a positive range at most 24h. Range is [from,to). Missing values are null. Thresholds are the current configured floor thresholds, not historical thresholds.'
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Chart points ordered by time; floors ordered by room and floor number
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     from: { type: number, description: Epoch milliseconds }
 *                     to: { type: number, description: Exclusive end in epoch milliseconds }
 *                     bucketMs: { type: integer, example: 900000 }
 *                     refreshAfterMs: { type: integer, example: 300000 }
 *                     floors:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           floorId: { type: integer }
 *                           floorName: { type: string }
 *                           floorNumber: { type: integer }
 *                           roomId: { type: integer }
 *                           masterDbId: { type: integer }
 *                           masterId: { type: string }
 *                           nodeId: { type: integer }
 *                           thresholds:
 *                             type: object
 *                             properties:
 *                               temperature_min: { type: number, nullable: true }
 *                               temperature_max: { type: number, nullable: true }
 *                               humidity_min: { type: number, nullable: true }
 *                               humidity_max: { type: number, nullable: true }
 *                           points:
 *                             type: array
 *                             items:
 *                               type: object
 *                               properties:
 *                                 timestamp: { type: number, description: Bucket start in epoch milliseconds }
 *                                 temperature: { type: number, nullable: true, description: Degrees Celsius }
 *                                 humidity: { type: number, nullable: true, description: Relative humidity percent }
 *       400: { description: Invalid time range }
 *       401: { description: Missing or invalid JWT }
 *       403: { description: Admin or Farm Operator only }
 */
router.get('/dashboard/environment-history', authenticate, authorizeRoles(1, 2), analyticsController.environmentHistory);

module.exports = router;
