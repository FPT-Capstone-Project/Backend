const paymentService = require('../services/payment.service');

async function createPayosPayment(req, res) {
  try {
    const payment = await paymentService.createPayosPayment(req.user.user_id, req.params.orderId);
    res.status(201).json({ success: true, message: 'PayOS payment created successfully', data: payment });
  } catch (error) {
    if (error && (error.isOperational || Number.isInteger(error.statusCode))) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
    throw error;
  }
}

async function getPayosPaymentStatus(req, res) {
  try {
    const status = await paymentService.getPayosPaymentStatus(req.user.user_id, req.params.orderId);
    res.status(200).json({ success: true, data: status });
  } catch (error) {
    if (error && (error.isOperational || Number.isInteger(error.statusCode))) {
      return res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
    throw error;
  }
}

async function payosWebhook(req, res) {
  const result = await paymentService.handlePayosWebhook(req.body);
  if (result && result.invalidSignature) return res.status(200).json({ message: 'invalid signature' });
  res.status(200).json({ success: true });
}

function payosWebhookHealth(req, res) {
  res.status(200).json(paymentService.payosWebhookHealth());
}

module.exports = {
  createPayosPayment,
  getPayosPaymentStatus,
  payosWebhook,
  payosWebhookHealth,
};
