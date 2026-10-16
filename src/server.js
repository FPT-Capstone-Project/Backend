require('dotenv').config();
process.env.TZ = 'Asia/Ho_Chi_Minh';

const app = require('./app');
const env = require('./config/env');
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

function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
