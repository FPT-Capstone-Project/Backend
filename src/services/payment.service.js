const crypto = require('crypto');
const env = require('../config/env');
const paymentModel = require('../models/payment.model');
const AppError = require('../utils/app-error');

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function parseWholeVndAmount(value, message) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError(message, 400);
  }
  return amount;
}

function ensureQrConfiguration() {
  if (!env.sepayBankCode || !env.sepayAccountNumber) {
    throw new AppError('SePay QR is not configured', 503);
  }
}

function buildSepayQrUrl(amount, paymentCode) {
  const url = new URL('https://vietqr.app/img');
  url.searchParams.set('acc', env.sepayAccountNumber);
  url.searchParams.set('bank', env.sepayBankCode);
  url.searchParams.set('amount', String(amount));
  url.searchParams.set('des', paymentCode);
  url.searchParams.set('template', env.sepayQrTemplate || 'compact');
  return url.toString();
}

function normalizeAccountNumber(value) {
  return String(value || '').replace(/\s+/g, '');
}

function extractPaymentCode(payload) {
  const sources = [payload.code, payload.content, payload.description];

  for (const source of sources) {
    const match = String(source || '').toUpperCase().match(/SP\d+P\d+/);
    if (match) return match[0];
  }

  return null;
}

function verifyWebhookSignature(rawBody, signature, timestamp) {
  if (!env.sepayWebhookSecret) {
    throw new AppError('SePay webhook is not configured', 503);
  }
  if (!Buffer.isBuffer(rawBody)) {
    throw new AppError('Invalid SePay webhook body', 400);
  }

  const sentAt = Number(timestamp);
  const maxAge = Number(env.sepayWebhookMaxAgeSeconds || 300);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(sentAt) || !Number.isFinite(maxAge) || maxAge <= 0 || Math.abs(now - sentAt) > maxAge) {
    throw new AppError('Expired SePay webhook signature', 401);
  }

  const hmac = crypto.createHmac('sha256', env.sepayWebhookSecret);
  hmac.update(`${timestamp}.`);
  hmac.update(rawBody);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;
  const providedSignature = String(signature || '');

  if (
    Buffer.byteLength(providedSignature) !== Buffer.byteLength(expectedSignature)
    || !crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(expectedSignature))
  ) {
    throw new AppError('Invalid SePay webhook signature', 401);
  }
}

function parseWebhookPayload(rawBody) {
  try {
    const payload = JSON.parse(rawBody.toString('utf8'));
    if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
      throw new Error('Payload must be an object');
    }
    return payload;
  } catch (error) {
    throw new AppError('Invalid SePay webhook payload', 400);
  }
}

async function createSepayQrPayment(userId, orderId) {
  ensureQrConfiguration();

  const customerId = parseId(userId, 'userId');
  const id = parseId(orderId, 'orderId');
  const payment = await paymentModel.createOrGetSepayPayment(id, customerId);
  const amount = parseWholeVndAmount(payment.amount, 'Order total must be a positive whole VND amount');

  return {
    payment_id: payment.payment_id,
    order_id: payment.order_id,
    amount,
    payment_method: payment.payment_method,
    payment_status: payment.status,
    payment_code: payment.transaction_code,
    bank_code: env.sepayBankCode,
    account_number: env.sepayAccountNumber,
    qr_url: buildSepayQrUrl(amount, payment.transaction_code),
  };
}

async function getSepayPaymentStatus(userId, orderId) {
  const customerId = parseId(userId, 'userId');
  const id = parseId(orderId, 'orderId');
  const result = await paymentModel.findSepayPaymentStatus(id, customerId);

  if (!result || !result.order) throw new AppError('Order not found', 404);
  if (!result.payment) throw new AppError('Payment not found for this order', 404);

  const amount = Number(result.payment.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AppError('Payment amount is invalid', 500);
  }

  return {
    orderId: result.order.order_id,
    orderStatus: result.order.status,
    paymentStatus: result.payment.status,
    paymentCode: result.payment.transaction_code,
    amount,
  };
}

async function handleSepayWebhook({ rawBody, signature, timestamp }) {
  verifyWebhookSignature(rawBody, signature, timestamp);
  const payload = parseWebhookPayload(rawBody);

  if (String(payload.transferType || '').toLowerCase() !== 'in') return null;
  if (normalizeAccountNumber(payload.accountNumber) !== normalizeAccountNumber(env.sepayAccountNumber)) return null;

  const paymentCode = extractPaymentCode(payload);
  if (!paymentCode) return null;

  const transferAmount = Number(payload.transferAmount);
  if (!Number.isSafeInteger(transferAmount) || transferAmount <= 0) return null;

  return paymentModel.markSepayPaymentAsPaid(paymentCode, transferAmount);
}

module.exports = {
  createSepayQrPayment,
  getSepayPaymentStatus,
  handleSepayWebhook,
};
