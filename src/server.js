require('dotenv').config();
process.env.TZ = 'Asia/Ho_Chi_Minh';

const app = require('./app');
const env = require('./config/env');
const iotMqtt = require('./services/iotMqtt.service');
const paymentModel = require('./models/payment.model');
const pool = require('./config/db');
const autoMisting = require('./services/autoMisting.worker');
// One MQTT connection per process; importing Express does not open a connection.
iotMqtt.start();
autoMisting.start();
const baseUrl = process.env.SERVER_URL || `http://localhost:${env.port}`;

const payosPaymentExpiryInterval = setInterval(() => {
  paymentModel.expireStalePayosPayments()
    .catch((error) => console.error('Không thể xử lý thanh toán PayOS hết hạn:', error));
}, 60_000);
payosPaymentExpiryInterval.unref();

const server = app.listen(env.port, () => {
  console.log(`
=================================
Máy chủ đang chạy trên cổng ${env.port}
Địa chỉ gốc: ${baseUrl}
Swagger: ${baseUrl}/api-docs
Kiểm tra hoạt động: ${baseUrl}/health
=================================
  `);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Đã nhận tín hiệu ${signal}. Đang đóng máy chủ...`);
  clearInterval(payosPaymentExpiryInterval);
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    await autoMisting.stop();
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      iotMqtt.stop(),
    ]);
    await pool.end();
    clearTimeout(deadline);
    process.exitCode = 0;
  } catch {
    console.error('Không thể tắt máy chủ');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
