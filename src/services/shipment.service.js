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

function parseOptionalTimestamp(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (
    typeof value !== 'string'
    || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    || !Number.isFinite(new Date(value).getTime())
  ) {
    throw new AppError(`${fieldName} must be a valid ISO date-time with timezone`, 400);
  }
  return new Date(value).toISOString();
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

function normalizeShipmentDetails(payload = {}) {
  const hasField = (field, alias) => Object.prototype.hasOwnProperty.call(payload, field)
    || (alias && Object.prototype.hasOwnProperty.call(payload, alias));
  if (!hasField('carrier')) throw new AppError('carrier is required', 400);
  if (!hasField('trackingCode', 'tracking_code')) {
    throw new AppError('trackingCode is required', 400);
  }
  if (!hasField('shippingFee', 'shipping_fee')) {
    throw new AppError('shippingFee is required', 400);
  }
  const hasShippedAt = Object.prototype.hasOwnProperty.call(payload, 'shippedAt')
    || Object.prototype.hasOwnProperty.call(payload, 'shipped_at');
  const shippedAt = Object.prototype.hasOwnProperty.call(payload, 'shippedAt')
    ? payload.shippedAt
    : payload.shipped_at;
  if (!hasShippedAt) {
    throw new AppError('shippedAt is required', 400);
  }
  const hasDeliveredAt = Object.prototype.hasOwnProperty.call(payload, 'deliveredAt')
    || Object.prototype.hasOwnProperty.call(payload, 'delivered_at');
  const deliveredAt = Object.prototype.hasOwnProperty.call(payload, 'deliveredAt')
    ? payload.deliveredAt
    : payload.delivered_at;
  return {
    carrier: parseOptionalText(payload.carrier, 'carrier', 100),
    trackingCode: parseOptionalText(
      payload.trackingCode ?? payload.tracking_code,
      'trackingCode',
      150,
    ),
    shippingFee: parseShippingFee(payload.shippingFee ?? payload.shipping_fee),
    shippedAt: parseOptionalTimestamp(shippedAt, 'shippedAt'),
    deliveredAt: !hasDeliveredAt
      ? undefined
      : parseOptionalTimestamp(deliveredAt, 'deliveredAt'),
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

async function updateShipmentStatus(shipmentId, status, deliveredAt, actor) {
  const parsedStatus = parseStatus(status);
  if (parsedStatus === 'DELIVERED') throw new AppError('Customer confirmation is required', 403);
  if (deliveredAt !== undefined) throw new AppError('Delivery time is set by customer confirmation', 400);
  return shipmentModel.updateStatus(parseId(shipmentId, 'shipmentId'), parsedStatus, actor);
}

async function confirmReceived(shipmentId, actor) {
  return shipmentModel.confirmReceived(parseId(shipmentId, 'shipmentId'), actor);
}

async function updateShipmentDetails(shipmentId, payload = {}) {
  return shipmentModel.updateDetails(
    parseId(shipmentId, 'shipmentId'),
    normalizeShipmentDetails(payload),
  );
}

module.exports = {
  createShipment,
  listShipments,
  listShipmentsForOrder,
  updateShipmentStatus,
  updateShipmentDetails,
  confirmReceived,
};
