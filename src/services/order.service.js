const orderModel = require('../models/order.model');
const AppError = require('../utils/app-error');

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

async function createCultivationOrder(userId, payload = {}) {
  const customerId = parseId(userId, 'userId');
  const rawPackageId = payload.packageId ?? payload.package_id;
  const packageId = parseId(rawPackageId, 'packageId');
  const mushroomTypeId = parseId(
    payload.mushroomTypeId ?? payload.mushroom_type_id,
    'mushroomTypeId',
  );
  const quantity = parseId(
    payload.quantity ?? payload.trayCount ?? payload.tray_count,
    'quantity',
  );

  return orderModel.createCultivationOrder({
    userId: customerId,
    packageId,
    mushroomTypeId,
    quantity,
  });
}

async function getCustomerOrders(userId) {
  const customerId = parseId(userId, 'userId');
  return orderModel.findAllByUserId(customerId);
}

async function getCustomerOrderDetails(userId, orderId) {
  const customerId = parseId(userId, 'userId');
  const id = parseId(orderId, 'orderId');
  const order = await orderModel.findByIdForUser(id, customerId);
  if (!order) throw new AppError('Order not found', 404);
  return order;
}

async function cancelCustomerOrder(userId, orderId) {
  const customerId = parseId(userId, 'userId');
  const id = parseId(orderId, 'orderId');
  return orderModel.cancelOrderForUser(id, customerId);
}

module.exports = {
  createCultivationOrder,
  getCustomerOrders,
  getCustomerOrderDetails,
  cancelCustomerOrder,
};