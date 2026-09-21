const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();

const otpRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  legacyHeaders: false,
  message: { message: 'Too many OTP requests, please try again later.' },
});

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Invalid input or role does not exist
 *       409:
 *         description: Email is already registered
 */
router.post('/register', authController.register);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Login and receive a JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid email or password
 *       403:
 *         description: User account is not active
 */
router.post('/login', authController.login);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Authentication]
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
 * /api/auth/register-otp:
 *   post:
 *     tags: [Auth OTP]
 *     summary: Register an unverified customer and send a registration OTP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: Nguyen Van A }
 *               email: { type: string, format: email, example: user@example.com }
 *               password: { type: string, minLength: 6, example: password123 }
 *               phone: { type: string, example: '0900000000' }
 *               address: { type: string, example: Ho Chi Minh City }
 *     responses:
 *       200: { description: OTP email sent }
 *       400: { description: Missing or invalid input }
 *       409: { description: Email is already registered }
 *       429: { description: OTP cooldown or rate limit exceeded }
 *       500: { description: Unable to send OTP email }
 */
router.post('/register-otp', otpRateLimiter, authController.registerOtp);

/**
 * @openapi
 * /api/auth/verify-registration-otp:
 *   post:
 *     tags: [Auth OTP]
 *     summary: Verify a registration OTP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, format: email, example: user@example.com }
 *               otp: { type: string, example: '123456' }
 *     responses:
 *       200: { description: Email verified }
 *       400: { description: Missing or invalid OTP }
 *       429: { description: Too many invalid OTP attempts or rate limit exceeded }
 *       500: { description: Internal server error }
 */
router.post('/verify-registration-otp', otpRateLimiter, authController.verifyRegistrationOtp);

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth OTP]
 *     summary: Request a password-reset OTP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email, example: user@example.com }
 *     responses:
 *       200: { description: Generic OTP request response }
 *       400: { description: Missing email }
 *       429: { description: Rate limit exceeded }
 *       500: { description: Internal server error }
 */
router.post('/forgot-password', otpRateLimiter, authController.forgotPassword);

/**
 * @openapi
 * /api/auth/reset-password-otp:
 *   post:
 *     tags: [Auth OTP]
 *     summary: Reset a password with a password-reset OTP
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp, new_password]
 *             properties:
 *               email: { type: string, format: email, example: user@example.com }
 *               otp: { type: string, example: '123456' }
 *               new_password: { type: string, minLength: 6, example: newpassword123 }
 *     responses:
 *       200: { description: Password reset }
 *       400: { description: Missing or invalid OTP or password }
 *       429: { description: Too many invalid OTP attempts or rate limit exceeded }
 *       500: { description: Internal server error }
 */
router.post('/reset-password-otp', otpRateLimiter, authController.resetPasswordOtp);

/**
 * @openapi
 * /api/auth/request-change-password-otp:
 *   post:
 *     tags: [Auth OTP]
 *     summary: Request an OTP to change the current password
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200: { description: OTP email sent }
 *       401: { description: Missing or invalid JWT token }
 *       404: { description: User not found }
 *       429: { description: OTP cooldown or rate limit exceeded }
 *       500: { description: Unable to send OTP email }
 */
router.post(
  '/request-change-password-otp',
  authenticate,
  otpRateLimiter,
  authController.requestChangePasswordOtp,
);

/**
 * @openapi
 * /api/auth/change-password-otp:
 *   put:
 *     tags: [Auth OTP]
 *     summary: Change the current password with an OTP
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otp, new_password]
 *             properties:
 *               otp: { type: string, example: '123456' }
 *               new_password: { type: string, minLength: 6, example: newpassword123 }
 *     responses:
 *       200: { description: Password changed }
 *       400: { description: Missing or invalid OTP or password }
 *       401: { description: Missing or invalid JWT token }
 *       404: { description: User not found }
 *       429: { description: Too many invalid OTP attempts or rate limit exceeded }
 *       500: { description: Internal server error }
 */
router.put('/change-password-otp', authenticate, otpRateLimiter, authController.changePasswordOtp);

module.exports = router;
