const express = require('express');
const mushroomConditionController = require('../controllers/mushroomCondition.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/mushroom-conditions:
 *   get:
 *     tags: [Mushroom Conditions]
 *     summary: Get all mushroom conditions
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: mushroomTypeId
 *         schema:
 *           type: integer
 *         description: Filter by mushroom type id
 *     responses:
 *       200:
 *         description: List of mushroom conditions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/MushroomCondition'
 *       401:
 *         description: Missing or invalid JWT token
 */
router.get('/', authenticate, mushroomConditionController.list);

/**
 * @openapi
 * /api/mushroom-conditions/{id}:
 *   get:
 *     tags: [Mushroom Conditions]
 *     summary: Get a mushroom condition by id
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
 *         description: Mushroom condition detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/MushroomCondition'
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Mushroom condition not found
 */
router.get('/:id', authenticate, mushroomConditionController.getById);

/**
 * @openapi
 * /api/mushroom-conditions:
 *   post:
 *     tags: [Mushroom Conditions]
 *     summary: Create a mushroom condition for a mushroom type
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateMushroomConditionRequest'
 *     responses:
 *       201:
 *         description: Mushroom condition created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MushroomCondition'
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Mushroom type not found
 *       409:
 *         description: This mushroom type already has a condition. Each mushroom type can only have one condition.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: Nấm này đã có condition rồi
 */
router.post('/', authenticate, mushroomConditionController.create);

/**
 * @openapi
 * /api/mushroom-conditions/{id}:
 *   put:
 *     tags: [Mushroom Conditions]
 *     summary: Update a mushroom condition
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
 *             $ref: '#/components/schemas/UpdateMushroomConditionRequest'
 *     responses:
 *       200:
 *         description: Mushroom condition updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MushroomCondition'
 *       400:
 *         description: Validation failed
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Mushroom condition not found
 *       409:
 *         description: Cannot assign this condition to a mushroom type that already has a condition.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: Nấm này đã có condition rồi
 */
router.put('/:id', authenticate, mushroomConditionController.update);

/**
 * @openapi
 * /api/mushroom-conditions/{id}:
 *   delete:
 *     tags: [Mushroom Conditions]
 *     summary: Delete a mushroom condition
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
 *         description: Mushroom condition deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/MushroomCondition'
 *       401:
 *         description: Missing or invalid JWT token
 *       404:
 *         description: Mushroom condition not found
 */
router.delete('/:id', authenticate, mushroomConditionController.remove);

module.exports = router;
