const orderService = require('../services/order.service');

async function create(req, res) {
  const order = await orderService.createCultivationOrder(req.user.user_id, req.body || {});
  res.status(201).json({ message: 'Order created successfully', data: order });
}

async function list(req, res) {
  const orders = await orderService.getCustomerOrders(req.user.user_id);
  res.json({ data: orders });
}

async function getById(req, res) {
  const order = await orderService.getCustomerOrderDetails(req.user.user_id, req.params.orderId);
  res.json({ data: order });
}

async function cancel(req, res) {
  const order = await orderService.cancelCustomerOrder(req.user.user_id, req.params.orderId);
  res.json({ message: 'Order cancelled successfully', data: order });
}

module.exports = { create, list, getById, cancel };