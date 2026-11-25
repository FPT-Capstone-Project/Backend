const express = require('express');
const cultivationTrayController = require('../controllers/cultivationTray.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/cultivation-trays/{id}/complete-sanitation:
 *   post:
 *     tags: [Cultivation Trays]
 *     summary: Confirm tray sanitation completed
 *     description: Admin or Farm Operator only. Requires MAINTENANCE with no ACTIVE tray assignment. Sets AVAILABLE and records last_cleaned_at and last_cleaned_by. Does not reactivate an inactive floor or position.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Tray ready; confirmation recorded }
 *       401: { description: Authentication required }
 *       403: { description: Staff role required }
 *       404: { description: Tray not found }
 *       409: { description: Tray not in maintenance or active assignment exists }
 */
router.post('/:id/complete-sanitation', authenticate, authorizeRoles(1, 2), cultivationTrayController.completeSanitation);

/**
 * @openapi
 * /api/cultivation-trays/qr/backfill:
 *   post:
 *     tags: [Cultivation Trays]
 *     summary: Generate QR tokens for trays that do not have one
 *     description: Admin and Farm Operator only. Existing QR tokens are preserved; safe to call repeatedly.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: Number and IDs of trays updated }
 *       401: { description: Authentication required }
 *       403: { description: Staff role required }
 */
router.post('/qr/backfill', authenticate, authorizeRoles(1, 2), cultivationTrayController.generateMissingQrTokens);

/**
 * @openapi
 * /api/cultivation-trays/qr/scan:
 *   post:
 *     tags: [Cultivation Trays]
 *     summary: Find a tray and its current cultivation sessions from a scanned QR token
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [qrToken]
 *             properties:
 *                qrToken: { type: string, example: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" }
 *     responses:
 *       200: { description: Tray information and currently active sessions }
 *       400: { description: QR token is missing or invalid }
 *       401: { description: Authentication required }
 *       404: { description: No tray matches the QR token }
 */
router.post('/qr/scan', authenticate, cultivationTrayController.scanQr);

/**
 * @openapi
 * /api/cultivation-trays/{id}/qr:
 *   get:
 *     tags: [Cultivation Trays]
 *     summary: Get the tray QR code as a PNG image
 *     description: The QR code encodes the opaque qrToken accepted by POST /api/cultivation-trays/qr/scan.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: QR code PNG image, content: { image/png: { schema: { type: string, format: binary } } } }
 *       401: { description: Authentication required }
 *       404: { description: Tray not found }
 *       409: { description: Tray has no QR token yet }
 */
router.get('/:id/qr', authenticate, cultivationTrayController.getQrImage);

/**
 * @openapi
 * /api/cultivation-trays:
 *   get:
 *     tags: [Cultivation Trays]
 *     summary: List cultivation trays
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: roomId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: floorId
 *         schema:
 *           type: integer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [AVAILABLE, OCCUPIED, MAINTENANCE, INACTIVE]
 *     responses:
 *       200:
 *         description: Cultivation tray list
 */
router.get('/', authenticate, cultivationTrayController.list);

/**
 * @openapi
 * /api/cultivation-trays/{id}:
 *   get:
 *     tags: [Cultivation Trays]
 *     summary: Get a cultivation tray by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Cultivation tray detail
 *       404:
 *         description: Cultivation tray not found
 */
router.get('/:id', authenticate, cultivationTrayController.getById);

/**
 * @openapi
 * /api/cultivation-trays:
 *   post:
 *     tags: [Cultivation Trays]
 *     summary: Create a cultivation tray
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCultivationTrayRequest'
 *     responses:
 *       201:
 *         description: Cultivation tray created successfully
 *       404:
 *         description: Cultivation room not found
 *       409:
 *         description: Tray code already exists
 */
router.post('/', authenticate, cultivationTrayController.create);

/**
 * @openapi
 * /api/cultivation-trays/{id}:
 *   put:
 *     tags: [Cultivation Trays]
 *     summary: Update a cultivation tray
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateCultivationTrayRequest'
 *     responses:
 *       200:
 *         description: Cultivation tray updated successfully
 *       404:
 *         description: Tray or room not found
 */
router.put('/:id', authenticate, cultivationTrayController.update);

/**
 * @openapi
 * /api/cultivation-trays/{id}:
 *   delete:
 *     tags: [Cultivation Trays]
 *     summary: Delete a cultivation tray
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Cultivation tray deleted successfully
 *       409:
 *         description: Tray is used by a cultivation session
 */
router.delete('/:id', authenticate, cultivationTrayController.remove);

module.exports = router;
