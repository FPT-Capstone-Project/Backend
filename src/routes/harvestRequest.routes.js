const express = require('express');
const harvestRequestController = require('../controllers/harvestRequest.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/harvest-requests/admin:
 *   get:
 *     tags: [Harvest Requests]
 *     summary: List customer receiving requests for Admin and Farm Operators
 *     description: Returns requests newest first, including order ID and code, customer ID, name, phone and email, receiving method, saved delivery address, pickup schedule, note, and request and session status. Includes requests even when a harvest record has not been created.
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Receiving requests in data array and total count }
 *       401: { description: Missing or invalid JWT token }
 *       403: { description: Admin or Farm Operator role required }
 */
router.get('/admin', authenticate, authorizeRoles(1, 2), harvestRequestController.adminList);

/**
 * @openapi
 * /api/harvest-requests:
 *   post:
 *     tags: [Harvest Requests]
 *     summary: Choose a receiving method for a harvest-ready cultivation session
 *     description: Select PICKUP or DELIVERY from Examples. Replace sessionId with your own harvest-ready session ID. Customer PICKUP requires scheduledAt from the harvest-ready date through three calendar days later, between 07:00 and 17:00 Vietnam time. DELIVERY does not require a schedule. For DELIVERY, blank or omitted deliveryAddress uses the customer profile address. If the profile has no address, enter deliveryAddress. Schedule examples use Vietnam time (UTC+07:00); adjust the date and time before testing.
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
 *               harvestMethod: { type: string, enum: [PICKUP, DELIVERY], description: PICKUP for customer self-harvest at the farm; DELIVERY for external delivery arranged by staff }
 *               scheduledAt: { type: string, format: date-time, description: Required for PICKUP; optional for DELIVERY }
 *               deliveryAddress: { type: string, description: Optional for DELIVERY; blank or omitted uses the customer profile address. Saved on this request only. }
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
 *                 deliveryAddress: ''
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
 *     description: Customers may update the receiving method only on the harvest-ready date and the following calendar day. Customer PICKUP schedules must be from the current Vietnam date through three calendar days after readiness, between 07:00 and 17:00 Vietnam time. Farm staff may adjust the schedule while the session remains eligible; staff pickup must be in the future, from today through three calendar days later, between 07:00 and 17:00 Vietnam time.
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
 *               deliveryAddress: { type: string, description: Optional for DELIVERY; blank or omitted uses the customer profile address. Saved on this request only. }
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
 *     description: Requires a completed harvest. PICKUP may be confirmed by the owning customer or farm staff; DELIVERY must be confirmed by farm staff after the external delivery is completed. No shipment record is required. Records confirmed_by and confirmation time, completes the session, and places its trays in MAINTENANCE awaiting WF-05 sanitation.
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
 *       409: { description: Harvest or pickup schedule is incomplete, or session is not HARVESTING }
 */
router.post('/:id/complete', authenticate, harvestRequestController.complete);

module.exports = router;
