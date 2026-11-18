const router = require('express').Router();
const controller = require('../controllers/complaint.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');

/**
 * @openapi
 * /api/orders/{orderId}/complaints:
 *   post:
 *     tags: [Complaints]
 *     summary: Customer submits a delivered harvest complaint
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: orderId, required: true, schema: { type: integer, minimum: 1 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [complaintType, description]
 *             properties:
 *               complaintType: { type: string, maxLength: 100 }
 *               description: { type: string, maxLength: 10000 }
 *               imageUrls:
 *                 type: array
 *                 maxItems: 10
 *                 items: { type: string, format: uri, description: HTTPS image URL }
 *     responses:
 *       201: { description: Complaint created with OPEN status }
 *       400: { description: Invalid content or image URLs }
 *       404: { description: Order not found or not owned }
 *       409: { description: Ineligible shipment or duplicate complaint }
 * /api/complaints:
 *   get:
 *     tags: [Complaints]
 *     summary: Staff lists complaints newest first
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, minimum: 1, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, minimum: 1, maximum: 100, default: 20 } }
 *       - { in: query, name: status, schema: { type: string, enum: [OPEN, IN_PROGRESS, WAITING_CUSTOMER, RESOLVED, REJECTED] } }
 *     responses:
 *       200: { description: Paginated complaints }
 * /api/complaints/my:
 *   get:
 *     tags: [Complaints]
 *     summary: Customer lists own complaints using page, pageSize and status filters
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Paginated owned complaints }
 * /api/complaints/my/{id}:
 *   get:
 *     tags: [Complaints]
 *     summary: Customer views own complaint details
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer, minimum: 1 } }
 *     responses:
 *       200: { description: Complaint, order, images, assigned staff and ordered replies }
 *       404: { description: Complaint not found or not owned }
 * /api/complaints/{id}:
 *   get:
 *     tags: [Complaints]
 *     summary: Staff or owning customer views complaint details
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer, minimum: 1 } }
 *     responses:
 *       200: { description: Complaint details }
 * /api/complaints/{id}/replies:
 *   post:
 *     tags: [Complaints]
 *     summary: Staff or owning customer replies to an active complaint
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer, minimum: 1 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 10000 }
 *     responses:
 *       201: { description: Reply created }
 *       409: { description: Complaint is final }
 * /api/complaints/{id}/assign:
 *   patch:
 *     tags: [Complaints]
 *     summary: Staff assigns an active Admin or Farm Operator
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer, minimum: 1 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assignedTo]
 *             properties:
 *               assignedTo: { type: integer, nullable: true }
 *     responses:
 *       200: { description: Assignment updated }
 *       400: { description: Ineligible assignee }
 * /api/complaints/{id}/status:
 *   patch:
 *     tags: [Complaints]
 *     summary: Admin or Farm Operator changes directly to any supported status
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer, minimum: 1 } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [OPEN, IN_PROGRESS, WAITING_CUSTOMER, RESOLVED, REJECTED] }
 *               resolution: { type: string, maxLength: 10000 }
 *     responses:
 *       200: { description: Complaint updated }
 *       400: { description: Invalid status or missing resolution }
 */
router.use(authenticate);
router.get('/my', authorizeRoles(3), controller.my);
router.get('/my/:complaintId', authorizeRoles(3), controller.detail);
router.get('/', authorizeRoles(1, 2), controller.list);
router.get('/:complaintId', authorizeRoles(1, 2, 3), controller.detail);
router.post('/:complaintId/replies', authorizeRoles(1, 2, 3), controller.reply);
router.patch('/:complaintId', authorizeRoles(1, 2), controller.update);
router.patch('/:complaintId/assign', authorizeRoles(1, 2), controller.assign);
router.patch('/:complaintId/status', authorizeRoles(1, 2), controller.status);

module.exports = router;
