require('dotenv').config();
process.env.TZ = 'Asia/Ho_Chi_Minh';

const app = require('./app');
const env = require('./config/env');
const iotMqtt = require('./services/iotMqtt.service');
const pool = require('./config/db');
// One MQTT connection per process; importing Express does not open a connection.
iotMqtt.start();
const baseUrl = process.env.SERVER_URL || `http://localhost:${env.port}`;

const server = app.listen(env.port, () => {
  console.log(`
=================================
Server running on port ${env.port}
Base URL: ${baseUrl}
Swagger: ${baseUrl}/api-docs
Health: ${baseUrl}/health
=================================
  `);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Closing server...`);
  const deadline = setTimeout(() => process.exit(1), 10000);
  deadline.unref();
  try {
    await Promise.all([
      new Promise((resolve) => server.close(resolve)),
      iotMqtt.stop(),
    ]);
    await pool.end();
    clearTimeout(deadline);
    process.exitCode = 0;
  } catch {
    console.error('Server shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
