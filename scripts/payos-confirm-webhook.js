const env = require('../src/config/env');
const AppError = require('../src/utils/app-error');
const { confirmPayosWebhook } = require('../src/utils/payos');

async function main() {
  if (!env.payosWebhookUrl) {
    throw new AppError('PAYOS_WEBHOOK_URL is not configured', 503);
  }

  const result = await confirmPayosWebhook(env.payosWebhookUrl);
  console.log('PayOS webhook confirmed:', JSON.stringify({ webhookUrl: result.webhookUrl }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
