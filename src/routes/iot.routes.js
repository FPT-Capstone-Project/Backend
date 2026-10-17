const express = require('express');
const controller = require('../controllers/iot.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();
router.use(authenticate);
router.get('/masters', controller.list);
router.get('/masters/:masterId/sensors', controller.sensors);
router.get('/masters/:masterId/nodes/:nodeId/sensors/:sensorId', controller.sensor);
router.get('/masters/:masterId/nodes/:nodeId/sensors/:sensorId/history', controller.history);
router.get('/masters/:masterId/ssr', controller.ssr);
router.post('/masters/:masterId/ssr/:channel/commands', controller.control);
router.get('/commands/:commandId', controller.command);

module.exports = router;
