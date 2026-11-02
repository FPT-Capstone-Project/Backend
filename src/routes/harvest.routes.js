const express = require('express');
const harvestController = require('../controllers/harvest.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const adminOrFarmOperator = [authenticate, authorizeRoles(1, 2)];

/**
 * @openapi
 * /api/harvests:
 *   post:
 *     tags: [Harvests]
 *     summary: Create the one planned harvest for a harvest-ready cultivation session
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId]
 *             properties:
 *               sessionId: { type: integer, minimum: 1, example: 15 }
 *     responses:
 *       201: { description: Planned harvest created }
 *       400: { description: Invalid session ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Cultivation session not found }
 *       409: { description: Session is not harvest ready or already has a harvest }
 */
router.post('/', adminOrFarmOperator, harvestController.create);

/**
 * @openapi
 * /api/harvests/admin:
 *   get:
 *     tags: [Harvests]
 *     summary: List harvests for Admin and Farm Operators
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PLANNED, IN_PROGRESS, COMPLETED, CANCELLED] }
 *       - in: query
 *         name: mushroomTypeId
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: fromDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: toDate
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: orderId
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Harvest list with order, customer, mushroom, yield, and receiving method }
 *       400: { description: Invalid filter }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 */
router.get('/admin', adminOrFarmOperator, harvestController.adminList);

/**
 * @openapi
 * /api/harvests/{id}/start:
 *   post:
 *     tags: [Harvests]
 *     summary: Start a planned harvest and move its session into HARVESTING
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Harvest started }
 *       400: { description: Invalid harvest ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Harvest not found }
 *       409: { description: Invalid harvest or cultivation-session transition }
 */
router.post('/:id/start', adminOrFarmOperator, harvestController.start);

/**
 * @openapi
 * /api/harvests/{id}/yield:
 *   post:
 *     tags: [Harvests]
 *     summary: Record the actual yield of an in-progress harvest
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
 *             required: [totalWeightKg, usableWeightKg, rejectedWeightKg]
 *             properties:
 *               totalWeightKg: { type: number, minimum: 0, example: 5.2 }
 *               usableWeightKg: { type: number, minimum: 0, example: 4.8 }
 *               rejectedWeightKg: { type: number, minimum: 0, example: 0.4 }
 *               qualityGrade: { type: string, maxLength: 20, example: A }
 *               notes: { type: string, maxLength: 2000 }
 *     responses:
 *       200: { description: Actual yield recorded }
 *       400: { description: Invalid weight or classified weights do not equal total weight }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Harvest not found }
 *       409: { description: Harvest is not in progress }
 */
router.post('/:id/yield', adminOrFarmOperator, harvestController.recordYield);

/**
 * @openapi
 * /api/harvests/{id}/complete:
 *   post:
 *     tags: [Harvests]
 *     summary: Complete an in-progress harvest after yield is recorded
 *     description: Completes the cultivation session but does not release or clean its trays.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Harvest and cultivation session completed }
 *       400: { description: Invalid harvest ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Harvest not found }
 *       409: { description: Yield is missing or the harvest cannot transition to completed }
 */
router.post('/:id/complete', adminOrFarmOperator, harvestController.complete);

/**
 * @openapi
 * /api/harvests/{id}:
 *   get:
 *     tags: [Harvests]
 *     summary: Get harvest detail with order, session, mushroom, yield, and receiving data
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Harvest detail }
 *       400: { description: Invalid harvest ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 *       404: { description: Harvest not found }
 */
router.get('/:id', adminOrFarmOperator, harvestController.getById);

module.exports = router;
