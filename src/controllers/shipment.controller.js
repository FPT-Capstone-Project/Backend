const shipmentService = require('../services/shipment.service');

async function create(req, res) {
  const shipment = await shipmentService.createShipment(req.body || {});
  res.status(201).json({ message: 'Shipment created successfully', data: shipment });
}

async function adminList(req, res) {
  const result = await shipmentService.listShipments();
  res.json({ data: result.shipments, total: result.total });
}

async function orderList(req, res) {
  const result = await shipmentService.listShipmentsForOrder(req.params.orderId, req.user);
  res.json({ orderId: result.orderId, data: result.shipments, total: result.total });
}

async function updateStatus(req, res) {
  const shipment = await shipmentService.updateShipmentStatus(
    req.params.id,
    req.body?.status,
    req.body?.deliveredAt ?? req.body?.delivered_at,
    req.user,
  );
  res.json({ message: 'Shipment status updated successfully', data: shipment });
}

async function updateDetails(req, res) {
  const shipment = await shipmentService.updateShipmentDetails(
    req.params.id,
    req.body || {},
  );
  res.json({ message: 'Shipment details updated successfully', data: shipment });
}

module.exports = { create, adminList, orderList, updateStatus, updateDetails };
