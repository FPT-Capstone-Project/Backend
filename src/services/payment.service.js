const env = require('../config/env');
const paymentModel = require('../models/payment.model');
const AppError = require('../utils/app-error');
const {
  signPaymentRequest,
  verifyWebhookSignature,
  createPayosPaymentLink,
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

function getPaymentExpireMinutes() {
  const minutes = Number(env.payosPaymentExpireMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 15;
}

function getExpiresAt() {
  return Math.floor(Date.now() / 1000) + (getPaymentExpireMinutes() * 60);
}

function toPaymentResponse(payment) {
  return {
    paymentId: payment.payment_id,
    orderCode: Number(payment.payment_id),
    orderId: payment.order_id,
    amount: Math.round(Number(payment.amount)),
    checkoutUrl: payment.payos_checkout_url,
    qrCode: payment.payos_qr_code,
    expiresAt: getExpiresAt(),
    paymentStatus: 'PENDING',
  };
}

async function createPayosPayment(userId, orderId) {
  ensurePayosConfiguration();

  const customerId = parseId(userId, 'userId');
  const id = parseId(orderId, 'orderId');
  const { payment, reused } = await paymentModel.createOrGetPayosPayment(
    id,
    customerId,
    getPaymentExpireMinutes(),
  );

  if (reused) return toPaymentResponse(payment);

  const expiresAt = getExpiresAt();
  const request = {
    orderCode: Number(payment.payment_id),
    amount: Math.round(Number(payment.amount)),
    description: `DH${id}`,
    returnUrl: env.payosReturnUrl,
    cancelUrl: env.payosCancelUrl,
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
  const customerId = parseId(userId, 'userId');
  const id = parseId(orderId, 'orderId');
  const result = await paymentModel.findPayosPaymentStatus(id, customerId);

  if (!result || !result.order) throw new AppError('Order not found', 404);
  if (!result.payment) throw new AppError('Payment not found for this order', 404);

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
  handlePayosWebhook,
  payosWebhookHealth,
};
