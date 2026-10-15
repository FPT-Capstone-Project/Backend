const paymentService = require('../services/payment.service');

async function createSepayQr(req, res) {
  const payment = await paymentService.createSepayQrPayment(req.user.user_id, req.params.orderId);
  res.status(201).json({ message: 'SePay payment QR created successfully', data: payment });
}

async function getSepayPaymentStatus(req, res) {
  try {
    const status = await paymentService.getSepayPaymentStatus(req.user.user_id, req.params.orderId);
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    if (error && (error.isOperational || Number.isInteger(error.statusCode))) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
    throw error;
  }
}

async function sepayWebhook(req, res) {
  await paymentService.handleSepayWebhook({
    rawBody: req.body,
    signature: req.get('X-SePay-Signature'),
    timestamp: req.get('X-SePay-Timestamp'),
  });
  res.status(200).json({ success: true });
}

module.exports = { createSepayQr, getSepayPaymentStatus, sepayWebhook };
