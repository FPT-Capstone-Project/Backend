const express = require('express');
const harvestRequestController = require('../controllers/harvestRequest.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/harvest-requests:
 *   post:
 *     tags: [Harvest Requests]
 *     summary: Choose a receiving method for a harvest-ready cultivation session
 *     description: Select PICKUP or DELIVERY from Examples. Replace sessionId with your own harvest-ready session ID. PICKUP requires scheduledAt; DELIVERY does not. customerNote is optional. Schedule examples use Vietnam time (UTC+07:00); adjust the date and time before testing.
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [sessionId, harvestMethod]
 *             properties:
 *               sessionId: { type: integer, minimum: 1, description: Your harvest-ready cultivation session ID }
 *               harvestMethod: { type: string, enum: [PICKUP, DELIVERY], description: PICKUP for collection at the farm; DELIVERY for shipment }
 *               scheduledAt: { type: string, format: date-time, description: Required for PICKUP; optional for DELIVERY }
 *               customerNote: { type: string, maxLength: 2000, description: Optional receiving instructions }
 *           examples:
 *             PICKUP:
 *               summary: PICKUP
 *               value:
 *                 sessionId: 15
 *                 harvestMethod: PICKUP
 *                 scheduledAt: '2026-11-05T09:00:00+07:00'
 *                 customerNote: I will collect the mushrooms at the farm at the scheduled time.
 *             DELIVERY:
 *               summary: DELIVERY
 *               value:
 *                 sessionId: 15
 *                 harvestMethod: DELIVERY
 *                 customerNote: Please contact me before delivery.
 *     responses:
 *       201: { description: Receiving request created }
 *       400: { description: Invalid request or missing pickup schedule }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Request does not belong to the customer }
 *       404: { description: Cultivation session not found }
 *       409: { description: Session is not ready or already has a receiving request }
 */
router.post('/', authenticate, harvestRequestController.create);

/**
 * @openapi
 * /api/harvest-requests/{id}:
 *   patch:
 *     tags: [Harvest Requests]
 *     summary: Update receiving method or pickup schedule
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
 *             required: [harvestMethod]
 *             properties:
 *               harvestMethod: { type: string, enum: [PICKUP, DELIVERY] }
 *               scheduledAt: { type: string, format: date-time }
 *               customerNote: { type: string, maxLength: 2000 }
 *     responses:
 *       200: { description: Receiving request updated }
 *       400: { description: Invalid receiving method or pickup schedule }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Request does not belong to the customer }
 *       404: { description: Harvest request not found }
 *       409: { description: Request is completed or the session is no longer eligible }
 */
router.patch('/:id', authenticate, harvestRequestController.update);

/**
 * @openapi
 * /api/harvest-requests/{id}/complete:
 *   post:
 *     tags: [Harvest Requests]
 *     summary: Complete receiving or handover after harvest completion
 *     description: Pickup requires the customer confirmation; delivery requires the existing shipment to be DELIVERED.
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Receiving completed }
 *       400: { description: Invalid harvest request ID }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Request does not belong to the customer }
 *       404: { description: Harvest request not found }
 *       409: { description: Harvest, delivery, or pickup confirmation is incomplete }
 */
router.post('/:id/complete', authenticate, harvestRequestController.complete);

module.exports = router;
