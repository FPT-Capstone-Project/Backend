const express = require('express');
const controller = require('../controllers/iot.controller');
const { authenticate } = require('../middlewares/auth.middleware');

const router = express.Router();
router.use(authenticate);
const auto = require('../controllers/autoMisting.controller');
const { manageAutomation } = require('../middlewares/autoMisting.middleware');
router.get('/floors', auto.list);
router.post('/floors', manageAutomation, auto.create);
router.put('/floors/:floorId', manageAutomation, auto.map);
router.put('/floors/:floorId/trays/:trayId', manageAutomation, auto.tray);
router.get('/floors/:floorId/environment', auto.environment);
router.get('/floors/:floorId/auto-control', auto.configuration);
router.put('/floors/:floorId/auto-control', manageAutomation, auto.save);
router.post('/floors/:floorId/auto-control/start', manageAutomation, auto.start);
router.post('/floors/:floorId/auto-control/stop', manageAutomation, auto.stop);
router.get('/floors/:floorId/auto-control/status', auto.status);
router.get('/floors/:floorId/auto-control/logs', auto.logs);
router.post('/floors/:floorId/auto-control/evaluate', manageAutomation, auto.evaluate);
router.get('/masters', controller.list);
router.get('/masters/:masterId/sensors', controller.sensors);
router.get('/masters/:masterId/nodes/:nodeId/sensors/:sensorId', controller.sensor);
router.get('/masters/:masterId/nodes/:nodeId/sensors/:sensorId/history', controller.history);
router.get('/masters/:masterId/ssr', controller.ssr);
router.post('/masters/:masterId/ssr/:channel/commands', controller.control);
router.get('/commands/:commandId', controller.command);

module.exports = router;
