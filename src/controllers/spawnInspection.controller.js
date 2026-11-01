const spawnInspectionService = require('../services/spawnInspection.service');

async function farmListSessions(req, res) {
  const sessions = await spawnInspectionService.listFarmSessions(req.query || {});
  res.json({ data: sessions });
}

async function farmGetSession(req, res) {
  const session = await spawnInspectionService.getFarmSession(req.params.id);
  res.json({ data: session });
}

async function farmCreateInspection(req, res) {
  const inspection = await spawnInspectionService.createFarmInspection(
    req.params.id,
    req.user.user_id,
    req.body || {},
  );
  res.status(201).json({ message: 'Spawn inspection recorded successfully', data: inspection });
}

async function farmListInspections(req, res) {
  const inspections = await spawnInspectionService.listFarmInspections(req.params.id);
  res.json({ data: inspections });
}

async function farmAddImage(req, res) {
  const image = await spawnInspectionService.addFarmInspectionImage(
    req.params.id,
    req.file,
    req.body || {},
  );
  res.status(201).json({ message: 'Inspection image uploaded successfully', data: image });
}

async function farmReplaceSpawn(req, res) {
  const inspection = await spawnInspectionService.replaceFarmSpawn(req.params.id, req.body || {});
  res.json({ message: 'Replacement spawn issued successfully', data: inspection });
}

async function farmChangeStage(req, res) {
  const session = await spawnInspectionService.changeFarmStage(req.params.id, req.body || {});
  res.json({ message: 'Cultivation session stage updated successfully', data: session });
}

async function customerCultivationStatus(req, res) {
  const result = await spawnInspectionService.getCustomerCultivationStatus(
    req.params.orderId,
    req.user.user_id,
    Number(req.user.role_id) === 1,
  );
  res.json({ data: result });
}

async function customerCultivationProgress(req, res) {
  const progress = await spawnInspectionService.getCustomerCultivationProgress(
    req.params.orderId,
    req.user.user_id,
    Number(req.user.role_id) === 1,
  );
  res.json({ data: progress });
}

async function customerSpawnInspections(req, res) {
  const inspections = await spawnInspectionService.getCustomerSpawnInspections(
    req.params.orderId,
    req.user.user_id,
    undefined,
    Number(req.user.role_id) === 1,
  );
  res.json({ data: inspections });
}

async function customerSpawnInspection(req, res) {
  const inspections = await spawnInspectionService.getCustomerSpawnInspections(
    req.params.orderId,
    req.user.user_id,
    req.params.inspectionId,
    Number(req.user.role_id) === 1,
  );
  res.json({ data: inspections[0] });
}

module.exports = {
  farmListSessions,
  farmGetSession,
  farmCreateInspection,
  farmListInspections,
  farmAddImage,
  farmReplaceSpawn,
  farmChangeStage,
  customerCultivationStatus,
  customerCultivationProgress,
  customerSpawnInspections,
  customerSpawnInspection,
};
