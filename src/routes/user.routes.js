const express = require('express');
const authController = require('../controllers/auth.controller');
const userController = require('../controllers/user.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

const router = express.Router();
const adminOnly = [authenticate, authorizeRoles(1)];

/**
 * @openapi
 * /api/users/me:
 *   get:
 *     tags: [Users]
 *     summary: Get the current authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Missing or invalid JWT token
 */
router.get('/me', authenticate, authController.me);

/**
 * @openapi
 * /api/users:
 *   get:
 *     tags: [Users]
 *     summary: List users with their roles
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: roleId
 *         description: Filter users by role ID
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       200:
 *         description: User list with role information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/UserWithRole'
 *       400:
 *         description: Invalid role ID
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Admin role is required
 */
router.get('/', adminOnly, userController.list);

/**
 * @openapi
 * /api/users:
 *   post:
 *     tags: [Users]
 *     summary: Create a user account and assign a role
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateManagedUserRequest'
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/UserAccountDetail'
 *       400:
 *         description: Invalid input or role does not exist
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Admin role is required
 *       409:
 *         description: Email is already registered
 */
router.post('/', adminOnly, userController.create);

/**
 * @openapi
 * /api/users/{userId}:
 *   get:
 *     tags: [Users]
 *     summary: Get an account with role, order count, and rental count
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       200:
 *         description: User account detail
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/UserAccountDetail'
 *       400:
 *         description: Invalid user ID
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Admin role is required
 *       404:
 *         description: User not found
 */
router.get('/:userId', adminOnly, userController.getById);

/**
 * @openapi
 * /api/users/{userId}/status:
 *   patch:
 *     tags: [Users]
 *     summary: Update a user account status
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateUserStatusRequest'
 *     responses:
 *       200:
 *         description: User status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         description: Invalid user ID or status
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Admin role is required
 *       404:
 *         description: User not found
 */
router.patch('/:userId/status', adminOnly, userController.updateStatus);

module.exports = router;
