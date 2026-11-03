const orderService = require('../services/order.service');
const harvestService = require('../services/harvest.service');

async function create(req, res) {
  const order = await orderService.createCultivationOrder(req.user.user_id, req.body || {});
  res.status(201).json({ message: 'Order created successfully', data: order });
}

async function list(req, res) {
  const orders = await orderService.getCustomerOrders(req.user.user_id);
  res.json({ data: orders });
}

async function adminList(req, res) {
  const result = await orderService.getAllForAdmin(req.query || {});
  res.json({ data: result.orders, pagination: result.pagination });
}

async function getById(req, res) {
  const order = await orderService.getCustomerOrderDetails(req.user.user_id, req.params.orderId);
  res.json({ data: order });
}

async function cancel(req, res) {
  const order = await orderService.cancelCustomerOrder(req.user.user_id, req.params.orderId);
  res.json({ message: 'Order cancelled successfully', data: order });
}

async function harvestHistory(req, res) {
  const history = await harvestService.getOrderHarvestHistory(req.params.orderId);
  res.json({ data: history });
}

module.exports = { create, list, adminList, getById, cancel, harvestHistory };
