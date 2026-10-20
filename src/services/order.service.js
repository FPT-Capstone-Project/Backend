const orderModel = require('../models/order.model');
const AppError = require('../utils/app-error');

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

async function createRentalOrder(userId, payload = {}) {
  const customerId = parseId(userId, 'userId');
  const rawPackageId = payload.packageId ?? payload.package_id;
  const packageId = rawPackageId === undefined || rawPackageId === null || rawPackageId === ''
    ? null
    : parseId(rawPackageId, 'packageId');
  const mushroomTypeId = parseId(
    payload.mushroomTypeId ?? payload.mushroom_type_id,
    'mushroomTypeId',
  );

  return orderModel.createRentalOrder({ userId: customerId, packageId, mushroomTypeId });
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
  createRentalOrder,
  getCustomerOrders,
  getCustomerOrderDetails,
  cancelCustomerOrder,
};