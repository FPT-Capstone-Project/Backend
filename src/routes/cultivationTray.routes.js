const express = require('express');
const cultivationTrayController = require('../controllers/cultivationTray.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

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