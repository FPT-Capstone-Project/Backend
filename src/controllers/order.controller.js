const orderService = require('../services/order.service');
const harvestService = require('../services/harvest.service');
const AppError = require('../utils/app-error');

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
  const roleId = Number(req.user?.role_id);
  if (roleId === 3) {
    await orderService.getCustomerOrderDetails(req.user.user_id, req.params.orderId);
  } else if (![1, 2].includes(roleId)) {
    throw new AppError('You do not have permission to access this order history', 403);
  }
  const history = await harvestService.getOrderHarvestHistory(req.params.orderId);
  res.json({ data: history });
}

async function customerHarvestHistory(req, res) {
  await orderService.getCustomerOrderDetails(req.user.user_id, req.params.orderId);
  const history = await harvestService.getOrderHarvestHistory(req.params.orderId);
  res.json({ data: history });
}

module.exports = { create, list, adminList, getById, cancel, harvestHistory, customerHarvestHistory };
