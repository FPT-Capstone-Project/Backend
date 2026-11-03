const orderModel = require('../models/order.model');
const AppError = require('../utils/app-error');
const env = require('../config/env');

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function getReservationHoldMinutes() {
  const minutes = Number(env.cultivationReservationHoldMinutes ?? env.payosPaymentExpireMinutes);
  const wholeMinutes = Math.floor(minutes);
  return Number.isFinite(wholeMinutes) && wholeMinutes > 0 ? wholeMinutes : 15;
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
    holdMinutes: getReservationHoldMinutes(),
  });
}

async function getCustomerOrders(userId) {
  const customerId = parseId(userId, 'userId');
  return orderModel.findAllByUserId(customerId);
}

async function getAllForAdmin(query = {}) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const pageSize = query.pageSize === undefined ? 20 : Number(query.pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * pageSize)) {
    throw new AppError('page must be a positive integer', 400);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new AppError('pageSize must be between 1 and 100', 400);
  }
  const result = await orderModel.findAllForAdmin({ limit: pageSize, offset: (page - 1) * pageSize });
  return {
    orders: result.orders,
    pagination: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
  };
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
  getAllForAdmin,
  createCultivationOrder,
  getCustomerOrders,
  getCustomerOrderDetails,
  cancelCustomerOrder,
};
