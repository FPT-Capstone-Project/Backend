const express = require('express');
const spawnInspectionController = require('../controllers/spawnInspection.controller');
const { authenticate, authorizeRoles } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/upload.middleware');

const router = express.Router();
const farmOperator = [authenticate, authorizeRoles(1, 2)];

/**
 * @openapi
 * /api/farm/sessions:
 *   get:
 *     tags: [Farm Spawn Workflow]
 *     summary: List paid sessions in the farm cultivation workflow
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, SPAWN_RESTING, MYCELIAL_DEVELOPMENT, READY_FOR_CULTIVATION, CULTIVATING, HARVEST_READY, HARVESTING, COMPLETED, CANCELLED]
 *     responses:
 *       200:
 *         description: Sessions with spawn and tray quantities
 *       403:
 *         description: Admin or Farm Operator role required
 */
router.get('/sessions', farmOperator, spawnInspectionController.farmListSessions);
router.get('/sessions/:id', farmOperator, spawnInspectionController.farmGetSession);

/**
 * @openapi
 * /api/farm/sessions/{id}/spawn-inspections:
 *   post:
 *     tags: [Farm Spawn Workflow]
 *     summary: Record spawn inspection and optional actual replacement
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
 *             type: object
 *             required: [totalChecked, normalQuantity, warningQuantity, abnormalQuantity, condition]
 *             properties:
 *               totalChecked: { type: integer, minimum: 1 }
 *               normalQuantity: { type: integer, minimum: 0 }
 *               warningQuantity: { type: integer, minimum: 0 }
 *               abnormalQuantity: { type: integer, minimum: 0 }
 *               condition: { type: string, enum: [NORMAL, WARNING, ABNORMAL] }
 *               replacementQuantity: { type: integer, minimum: 0 }
 *               notes: { type: string }
 *               nextCheckAt: { type: string, format: date-time }
 *     responses:
 *       201:
 *         description: Inspection saved; replacement stock is deducted transactionally
 *       409:
 *         description: Session is not in an inspectable stage or replacement stock is insufficient
 */
router.post('/sessions/:id/spawn-inspections', farmOperator, spawnInspectionController.farmCreateInspection);
router.get('/sessions/:id/spawn-inspections', farmOperator, spawnInspectionController.farmListInspections);

/**
 * @openapi
 * /api/farm/sessions/{id}/spawn-inspections:
 *   get:
 *     tags: [Farm Spawn Workflow]
 *     summary: View spawn inspection history for a session
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
 *         description: Inspection history, including uploaded image metadata
 *       404:
 *         description: Session not found
 */
router.post(
  '/spawn-inspections/:id/images',
  farmOperator,
  upload.single('image'),
  spawnInspectionController.farmAddImage,
);
router.post(
  '/spawn-inspections/:id/replacements',
  farmOperator,
  spawnInspectionController.farmReplaceSpawn,
);

/**
 * @openapi
 * /api/farm/spawn-inspections/{id}/images:
 *   post:
 *     tags: [Farm Spawn Workflow]
 *     summary: Upload an inspection image to Cloudinary
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
 *             required: [image]
 *             properties:
 *               image: { type: string, format: binary }
 *               caption: { type: string }
 *     responses:
 *       201:
 *         description: Uploaded image linked to the spawn inspection
 *       404:
 *         description: Inspection not found
 */
/**
 * @openapi
 * /api/farm/spawn-inspections/{id}/replacements:
 *   post:
 *     tags: [Farm Spawn Workflow]
 *     summary: Issue replacement spawn for abnormal units already recorded
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
 *             type: object
 *             required: [replacementQuantity]
 *             properties:
 *               replacementQuantity: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Stock deducted and inventory transaction recorded
 *       409:
 *         description: Insufficient stock or inspection is no longer in its current stage
 */

/**
 * @openapi
 * /api/farm/sessions/{id}/stage:
 *   patch:
 *     tags: [Farm Spawn Workflow]
 *     summary: Start the combined resting/incubation phase or mark spawn ready for cultivation
 *     description: Resting and mycelial development happen together. From PENDING choose SPAWN_RESTING or MYCELIAL_DEVELOPMENT (existing equivalent phase values). Either can move directly to READY_FOR_CULTIVATION after the latest spawn inspection is NORMAL and covers all spawn units. Payment and stock issuance are required. No sequential resting-to-incubation transition is needed.
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
 *             type: object
 *             required: [stage]
 *             properties:
 *               stage:
 *                 type: string
 *                 enum: [SPAWN_RESTING, MYCELIAL_DEVELOPMENT, READY_FOR_CULTIVATION]
 *     responses:
 *       200:
 *         description: Spawn phase updated successfully
 *       400:
 *         description: Invalid stage or session ID
 *       401:
 *         description: Missing or invalid JWT token
 *       403:
 *         description: Admin or Farm Operator role required
 *       404:
 *         description: Session not found
 *       409:
 *         description: Stage transition requirements are not met
 */
router.patch('/sessions/:id/stage', farmOperator, spawnInspectionController.farmChangeStage);

module.exports = router;
