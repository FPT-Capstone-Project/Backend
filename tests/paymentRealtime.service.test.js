const test = require('node:test');
const assert = require('node:assert/strict');
const { createPaymentRealtimeService } = require('../src/services/paymentRealtime.service');

test('emits only an allowlisted payment state to the owning user', () => {
  const emitted = [];
  const service = createPaymentRealtimeService({
    emit: (...args) => emitted.push(args),
    logger: { error() {} },
  });

  service.publishOrderPaymentStatus(8, 23, 'PROCESSING', 'PAID');
  assert.deepEqual(emitted, [[8, 'payment:status.updated', {
    orderId: 23,
    orderStatus: 'PROCESSING',
    paymentStatus: 'PAID',
  }]]);
});

test('does not emit invalid status values', () => {
  const emitted = [];
  const errors = [];
  const service = createPaymentRealtimeService({
    emit: (...args) => emitted.push(args),
    logger: { error: (...args) => errors.push(args) },
  });

  service.publishOrderPaymentStatus(8, 23, 'PROCESSING', 'UNVERIFIED');
  assert.deepEqual(emitted, []);
  assert.equal(errors.length, 1);
});
