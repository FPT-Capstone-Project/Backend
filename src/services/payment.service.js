const env = require('../config/env');
const paymentModel = require('../models/payment.model');
const AppError = require('../utils/app-error');
const {
  signPaymentRequest,
  verifyWebhookSignature,
  createPayosPaymentLink,
  getPayosPaymentRequest,
} = require('../utils/payos');

function parseId(value, fieldName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new AppError(`${fieldName} must be a positive integer`, 400);
  }
  return parsed;
}

function ensurePayosConfiguration() {
  if (!env.payosClientId || !env.payosApiKey || !env.payosChecksumKey) {
    throw new AppError('PayOS is not configured', 503);
  }
}

function getPayosRedirectUrl(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(`${fieldName} must be configured`, 503);
  }
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol');
  } catch {
    throw new AppError(`${fieldName} must be a valid HTTP(S) URL`, 503);
  }
  return value.trim();
}

function getWholePaymentAmount(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new AppError('Payment amount must be a positive whole VND amount', 500);
  }
  return amount;
}

function getPayosDescription(orderId) {
  return `DH${String(orderId).slice(-7)}`;
}

function getReservationHoldMinutes() {
  const minutes = Number(env.cultivationReservationHoldMinutes ?? env.payosPaymentExpireMinutes);
  const wholeMinutes = Math.floor(minutes);
  return Number.isFinite(wholeMinutes) && wholeMinutes > 0 ? wholeMinutes : 15;
}

function getExpiresAt(payment) {
  const persistedExpiry = Number(payment.expires_at_epoch);
  if (Number.isSafeInteger(persistedExpiry) && persistedExpiry > 0) return persistedExpiry;

  const parsedExpiry = new Date(payment.expires_at).getTime();
  if (Number.isFinite(parsedExpiry)) return Math.floor(parsedExpiry / 1000);

  throw new AppError('Payment reservation has no expiry', 409);
}

function toPaymentResponse(payment) {
  return {
    paymentId: payment.payment_id,
    orderCode: Number(payment.payment_id),
    orderId: payment.order_id,
    amount: getWholePaymentAmount(payment.amount),
    checkoutUrl: payment.payos_checkout_url,
    qrCode: payment.payos_qr_code,
    expiresAt: getExpiresAt(payment),
    paymentStatus: 'PENDING',
  };
}

async function createPayosPayment(userId, orderId) {
  ensurePayosConfiguration();

  const customerId = parseId(userId, 'userId');
  const id = parseId(orderId, 'orderId');
  const returnUrl = getPayosRedirectUrl(env.payosReturnUrl, 'PAYOS_RETURN_URL');
  const cancelUrl = getPayosRedirectUrl(env.payosCancelUrl, 'PAYOS_CANCEL_URL');
  const { payment, reused } = await paymentModel.createOrGetPayosPayment(
    id,
    customerId,
    getReservationHoldMinutes(),
  );

  if (reused) return toPaymentResponse(payment);

  const expiresAt = getExpiresAt(payment);
  if (expiresAt <= Math.floor(Date.now() / 1000)) {
    await paymentModel.markPayosPaymentFailed(payment.payment_id);
    throw new AppError('Payment reservation has expired', 409);
  }
  const request = {
    orderCode: Number(payment.payment_id),
    amount: getWholePaymentAmount(payment.amount),
    description: getPayosDescription(id),
    returnUrl,
    cancelUrl,
    expiredAt: expiresAt,
  };

  try {
    const payosPayment = await createPayosPaymentLink({
      ...request,
      signature: signPaymentRequest(request),
    });
    const savedPayment = await paymentModel.savePayosPaymentLink(payment.payment_id, {
      paymentLinkId: payosPayment.paymentLinkId,
      checkoutUrl: payosPayment.checkoutUrl,
      qrCode: payosPayment.qrCode,
      expiresAt: payment.expires_at,
    });
    if (!savedPayment) throw new AppError('Payment is no longer available', 409);
    return toPaymentResponse(savedPayment);
  } catch (error) {
    await paymentModel.markPayosPaymentFailed(payment.payment_id);
    if (error && Number.isInteger(error.statusCode)) throw error;
    throw new AppError('PayOS request failed', 502);
  }
}

async function getPayosPaymentStatus(userId, orderId) {
  const result = await getOwnedPayosPayment(userId, orderId);
  return toPaymentStatusResponse(result);
}

async function getOwnedPayosPayment(userId, orderId) {
  const customerId = parseId(userId, 'userId');
  const id = parseId(orderId, 'orderId');
  const result = await paymentModel.findPayosPaymentStatus(id, customerId);

  if (!result || !result.order) throw new AppError('Order not found', 404);
  if (!result.payment) throw new AppError('Payment not found for this order', 404);

  return result;
}

function toPaymentStatusResponse(result) {
  const amount = Number(result.payment.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new AppError('Payment amount is invalid', 500);
  }

  return {
    orderId: result.order.order_id,
    orderStatus: result.order.status,
    paymentStatus: result.order.payment_status,
    paymentCode: String(result.payment.payment_id),
    amount,
  };
}

function paymentReference(payment) {
  if (typeof payment.reference === 'string' && payment.reference) return payment.reference;
  if (!Array.isArray(payment.transactions)) return null;
  const transaction = [...payment.transactions]
    .reverse()
    .find((entry) => entry && typeof entry.reference === 'string' && entry.reference);
  return transaction ? transaction.reference : null;
}

async function syncPayosPayment(userId, orderId) {
  ensurePayosConfiguration();

  const local = await getOwnedPayosPayment(userId, orderId);
  if (local.payment.status === 'PAID') {
    return {
      synced: false,
      payosStatus: 'PAID',
      ...toPaymentStatusResponse(local),
    };
  }

  const providerPayment = await getPayosPaymentRequest(local.payment.payment_id);
  if (!providerPayment || typeof providerPayment !== 'object') {
    throw new AppError('PayOS returned an invalid payment response', 502);
  }
  if (Number(providerPayment.orderCode) !== Number(local.payment.payment_id)) {
    throw new AppError('PayOS payment reference does not match this order', 502);
  }

  const payosStatus = typeof providerPayment.status === 'string'
    ? providerPayment.status.toUpperCase()
    : 'UNKNOWN';
  if (payosStatus !== 'PAID') {
    return {
      synced: false,
      payosStatus,
      ...toPaymentStatusResponse(local),
    };
  }

  const paidAmount = Number(providerPayment.amountPaid);
  if (!Number.isSafeInteger(paidAmount) || paidAmount <= 0) {
    throw new AppError('PayOS paid amount is invalid', 502);
  }
  const expectedAmount = getWholePaymentAmount(local.payment.amount);
  const providerAmount = Number(providerPayment.amount);
  if (!Number.isSafeInteger(providerAmount) || providerAmount !== expectedAmount) {
    throw new AppError('PayOS payment amount does not match this order', 502);
  }
  if (paidAmount < expectedAmount) {
    throw new AppError('PayOS paid amount is lower than the order total', 409);
  }

  const payment = await paymentModel.markPayosPaymentAsPaid(
    local.payment.payment_id,
    paidAmount,
    paymentReference(providerPayment),
  );
  if (!payment) throw new AppError('Payment could not be synchronized', 409);

  const synchronized = await getOwnedPayosPayment(userId, orderId);
  return {
    synced: true,
    payosStatus,
    ...toPaymentStatusResponse(synchronized),
  };
}

function warnIgnoredPayosWebhook(payload, reason) {
  const data = payload && payload.data && typeof payload.data === 'object' ? payload.data : {};
  const reasons = {
    invalid_signature: 'chữ ký không hợp lệ',
    invalid_order_code: 'mã đơn hàng không hợp lệ',
  };
  console.warn(`Đã bỏ qua webhook PayOS: ${reasons[reason] || 'chưa xác định nguyên nhân'}`, {
    orderCode: data.orderCode ?? null,
    amount: data.amount ?? null,
    code: payload && payload.code ? payload.code : null,
    reason,
  });
}

async function handlePayosWebhook(payload) {
  if (!payload || typeof payload !== 'object' || !verifyWebhookSignature(payload.data, payload.signature)) {
    warnIgnoredPayosWebhook(payload, 'invalid_signature');
    return { invalidSignature: true };
  }

  const data = payload.data || {};
  const orderCode = Number(data.orderCode);
  if (!Number.isSafeInteger(orderCode) || orderCode <= 0) {
    warnIgnoredPayosWebhook(payload, 'invalid_order_code');
    return null;
  }

  if (payload.success !== true || payload.code !== '00' || data.code !== '00') {
    await paymentModel.markPayosPaymentFailed(orderCode);
    return null;
  }

  return paymentModel.markPayosPaymentAsPaid(orderCode, Number(data.amount), data.reference);
}

function payosWebhookHealth() {
  return { ok: true };
}

module.exports = {
  createPayosPayment,
  getPayosPaymentStatus,
  syncPayosPayment,
  handlePayosWebhook,
  payosWebhookHealth,
};
