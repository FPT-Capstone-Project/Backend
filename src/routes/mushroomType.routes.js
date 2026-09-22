const express = require('express');
const mushroomTypeController = require('../controllers/mushroomType.controller');
const { authenticate } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/mushroom-types:
 *   get:
 *     tags: [Mushroom Types]
 *     summary: Get all mushroom types
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE]
 *         description: Filter by status
 *     responses:
 *       200:
 *         description: List of mushroom types
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MushroomType'
 *       401:
 *         description: Missing or invalid JWT token
 */
router.get('/', authenticate, mushroomTypeController.list);

/**
 * @openapi
 * /api/mushroom-types/{id}:
 *   get:
 *     tags: [Mushroom Types]
 *     summary: Get a mushroom type by id
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Mushroom type id
 *     responses:
 *       200:
 *         description: Mushroom type detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/MushroomType'
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Mushroom type not found
 */
router.get('/:id', authenticate, mushroomTypeController.getById);

/**
 * @openapi
 * /api/mushroom-types:
 *   post:
 *     tags: [Mushroom Types]
 *     summary: Create a new mushroom type with optional image upload
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - growingDays
 *               - price
 *             properties:
 *               name:
 *                 type: string
 *                 example: King Oyster
 *               description:
 *                 type: string
 *                 example: Mushroom type for soups and hotpot
 *               growingDays:
 *                 type: integer
 *                 example: 25
 *               price:
 *                 type: number
 *                 example: 120000
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE]
 *                 example: ACTIVE
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Mushroom type created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MushroomType'
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Missing or invalid JWT token
 *       409:
 *         description: Mushroom type name already exists
 */
router.post('/', authenticate, upload.single('image'), mushroomTypeController.create);

/**
 * @openapi
 * /api/mushroom-types/{id}:
 *   put:
 *     tags: [Mushroom Types]
 *     summary: Update a mushroom type with optional image upload
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 example: King Oyster Premium
 *               description:
 *                 type: string
 *                 example: Updated description
 *               growingDays:
 *                 type: integer
 *                 example: 30
 *               price:
 *                 type: number
 *                 example: 150000
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, INACTIVE]
 *                 example: INACTIVE
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Mushroom type updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MushroomType'
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Mushroom type not found
 */
router.put('/:id', authenticate, upload.single('image'), mushroomTypeController.update);

/**
 * @openapi
 * /api/mushroom-types/{id}:
 *   delete:
 *     tags: [Mushroom Types]
 *     summary: Delete a mushroom type
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
 *         description: Mushroom type deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MushroomType'
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Mushroom type not found
 */
router.delete('/:id', authenticate, mushroomTypeController.remove);

module.exports = router;
