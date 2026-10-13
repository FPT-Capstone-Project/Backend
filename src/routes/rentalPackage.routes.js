const express = require('express');
const rentalPackageController = require('../controllers/rentalPackage.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

/**
 * @openapi
 * /api/rental-packages:
 *   get:
 *     tags: [Rental Packages]
 *     summary: Get rental packages
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE]
 *     responses:
 *       200:
 *         description: Rental package list
 *       401:
 *         description: Missing or invalid JWT token
 */
router.get('/', authenticate, rentalPackageController.list);

/**
 * @openapi
 * /api/rental-packages/{id}:
 *   get:
 *     tags: [Rental Packages]
 *     summary: Get a rental package by id
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
 *         description: Rental package detail
 *       404:
 *         description: Rental package not found
 */
router.get('/:id', authenticate, rentalPackageController.getById);

/**
 * @openapi
 * /api/rental-packages:
 *   post:
 *     tags: [Rental Packages]
 *     summary: Create a rental package
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateRentalPackageRequest'
 *     responses:
 *       201:
 *         description: Rental package created successfully
 *       400:
 *         description: Validation failed
 */
router.post('/', authenticate, rentalPackageController.create);

/**
 * @openapi
 * /api/rental-packages/{id}:
 *   put:
 *     tags: [Rental Packages]
 *     summary: Update a rental package
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
 *             $ref: '#/components/schemas/UpdateRentalPackageRequest'
 *     responses:
 *       200:
 *         description: Rental package updated successfully
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Rental package not found
 */
router.put('/:id', authenticate, rentalPackageController.update);

/**
 * @openapi
 * /api/rental-packages/{id}:
 *   delete:
 *     tags: [Rental Packages]
 *     summary: Delete a rental package
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
 *         description: Rental package deleted successfully
 *       404:
 *         description: Rental package not found
 *       409:
 *         description: Package is referenced by an order or rental
 */
router.delete('/:id', authenticate, rentalPackageController.remove);

module.exports = router;