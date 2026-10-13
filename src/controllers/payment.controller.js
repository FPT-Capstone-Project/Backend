const paymentService = require('../services/payment.service');

async function createSepayQr(req, res) {
  const payment = await paymentService.createSepayQrPayment(req.user.user_id, req.params.orderId);
  res.status(201).json({ message: 'SePay payment QR created successfully', data: payment });
}

async function sepayWebhook(req, res) {
  await paymentService.handleSepayWebhook({
    rawBody: req.body,
    signature: req.get('X-SePay-Signature'),
    timestamp: req.get('X-SePay-Timestamp'),
  });
  res.status(200).json({ success: true });
}

module.exports = { createSepayQr, sepayWebhook };
