const { emitToUser } = require('../socket');

const ORDER_STATUSES = new Set(['PENDING', 'CONFIRMED', 'PROCESSING', 'COMPLETED', 'CANCELLED']);
const PAYMENT_STATUSES = new Set([
  'UNPAID',
  'PENDING',
  'PAID',
  'FAILED',
  'REFUND_PENDING',
  'REFUNDED',
]);

function createPaymentRealtimeService({ emit = emitToUser, logger = console } = {}) {
  function publishOrderPaymentStatus(userId, orderId, orderStatus, paymentStatus) {
    const recipientId = Number(userId);
    const id = Number(orderId);
    if (!Number.isSafeInteger(recipientId) || recipientId <= 0
      || !Number.isSafeInteger(id) || id <= 0
      || !ORDER_STATUSES.has(orderStatus)
      || !PAYMENT_STATUSES.has(paymentStatus)) {
      logger.error('Không thể phát trạng thái thanh toán realtime: dữ liệu không hợp lệ.');
      return;
    }

    try {
      emit(recipientId, 'payment:status.updated', {
        orderId: id,
        orderStatus,
        paymentStatus,
      });
    } catch (error) {
      logger.error('Không thể phát trạng thái thanh toán realtime tới user:', error);
    }
  }

  return { publishOrderPaymentStatus };
}

module.exports = { ...createPaymentRealtimeService(), createPaymentRealtimeService };
