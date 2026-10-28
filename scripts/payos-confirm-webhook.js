const env = require('../src/config/env');
const AppError = require('../src/utils/app-error');
const { confirmPayosWebhook } = require('../src/utils/payos');

async function main() {
  if (!env.payosWebhookUrl) {
    throw new AppError('Chưa cấu hình PAYOS_WEBHOOK_URL', 503);
  }

  const result = await confirmPayosWebhook(env.payosWebhookUrl);
  console.log('Đã xác nhận webhook PayOS:', JSON.stringify({ webhookUrl: result.webhookUrl }));
}

main().catch((error) => {
  console.error('Không thể xác nhận webhook PayOS:', error.message);
  process.exitCode = 1;
});
