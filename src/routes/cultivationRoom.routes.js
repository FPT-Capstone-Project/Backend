const express = require('express');
const cultivationRoomController = require('../controllers/cultivationRoom.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/cultivation-rooms:
 *   get:
 *     tags: [Cultivation Rooms]
 *     summary: List cultivation rooms
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE, MAINTENANCE]
 *     responses:
 *       200:
 *         description: Cultivation room list
 *       401:
 *         description: Missing or invalid JWT token
 */
router.get('/', authenticate, cultivationRoomController.list);

/**
 * @openapi
 * /api/cultivation-rooms/{id}:
 *   get:
 *     tags: [Cultivation Rooms]
 *     summary: Get a cultivation room by id
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
 *         description: Cultivation room detail
 *       404:
 *         description: Cultivation room not found
 */
router.get('/:id', authenticate, cultivationRoomController.getById);

/**
 * @openapi
 * /api/cultivation-rooms:
 *   post:
 *     tags: [Cultivation Rooms]
 *     summary: Create a cultivation room
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateCultivationRoomRequest'
 *     responses:
 *       201:
 *         description: Cultivation room created successfully
 *       409:
 *         description: Room code already exists
 */
router.post('/', authenticate, cultivationRoomController.create);

/**
 * @openapi
 * /api/cultivation-rooms/{id}:
 *   put:
 *     tags: [Cultivation Rooms]
 *     summary: Update a cultivation room
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
 *             $ref: '#/components/schemas/UpdateCultivationRoomRequest'
 *     responses:
 *       200:
 *         description: Cultivation room updated successfully
 *       404:
 *         description: Cultivation room not found
 */
router.put('/:id', authenticate, cultivationRoomController.update);

/**
 * @openapi
 * /api/cultivation-rooms/{id}:
 *   delete:
 *     tags: [Cultivation Rooms]
 *     summary: Delete a cultivation room
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
 *         description: Cultivation room deleted successfully
 *       409:
 *         description: Room is still referenced by trays or devices
 */
router.delete('/:id', authenticate, cultivationRoomController.remove);

module.exports = router;