const shipmentModel = require('../models/shipment.model');
const AppError = require('../utils/app-error');

const SHIPMENT_STATUSES = ['PENDING', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED', 'RETURNED'];

function parseId(value, fieldName) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return id;
}

function parseRequiredText(value, fieldName, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`${fieldName} is required`, 400);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw new AppError(`${fieldName} must be at most ${maxLength} characters`, 400);
  }
  return text;
}

function parseOptionalText(value, fieldName, maxLength) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new AppError(`${fieldName} must be a string`, 400);
  const text = value.trim();
  if (text.length > maxLength) {
    throw new AppError(`${fieldName} must be at most ${maxLength} characters`, 400);
  }
  return text || null;
}

function parseShippingFee(value) {
  if (value === undefined || value === null || value === '') return 0;
  if ((typeof value !== 'number' && typeof value !== 'string')
    || (typeof value === 'string' && !value.trim())) {
    throw new AppError('shippingFee must be a non-negative number', 400);
  }
  const fee = Number(value);
  if (!Number.isFinite(fee) || fee < 0 || fee > 9999999999.99) {
    throw new AppError('shippingFee must be between 0 and 9999999999.99', 400);
  }
  return fee;
}

function normalizeShipment(payload = {}) {
  return {
    orderId: parseId(payload.orderId ?? payload.order_id, 'orderId'),
    address: parseRequiredText(payload.address, 'address', 2000),
    recipientName: parseRequiredText(
      payload.recipientName ?? payload.recipient_name,
      'recipientName',
      150,
    ),
    recipientPhone: parseRequiredText(
      payload.recipientPhone ?? payload.recipient_phone,
      'recipientPhone',
      30,
    ),
    shippingFee: parseShippingFee(payload.shippingFee ?? payload.shipping_fee),
    carrier: parseOptionalText(payload.carrier, 'carrier', 100),
    trackingCode: parseOptionalText(
      payload.trackingCode ?? payload.tracking_code,
      'trackingCode',
      150,
    ),
  };
}

function parseStatus(value) {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!SHIPMENT_STATUSES.includes(status)) {
    throw new AppError(`status must be one of: ${SHIPMENT_STATUSES.join(', ')}`, 400);
  }
  return status;
}

async function listShipments() {
  return shipmentModel.findAllForAdmin();
}

async function listShipmentsForOrder(orderId, actor) {
  return shipmentModel.findAllForOrder(parseId(orderId, 'orderId'), actor);
}

async function createShipment(payload = {}) {
  return shipmentModel.create(normalizeShipment(payload));
}

async function updateShipmentStatus(shipmentId, status, actor) {
  return shipmentModel.updateStatus(
    parseId(shipmentId, 'shipmentId'),
    parseStatus(status),
    actor,
  );
}

module.exports = {
  createShipment,
  listShipments,
  listShipmentsForOrder,
  updateShipmentStatus,
};
