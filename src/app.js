const express = require('express');
const rootRouter = require('./routes/root.routes');
const swaggerRoutes = require('./routes/swagger.routes');

const app = express();

// SePay signs the exact request bytes, so this path must be parsed before JSON middleware.
app.use('/api/payments/sepay/webhook', express.raw({ type: 'application/json', limit: '100kb' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(swaggerRoutes);
app.use('/api', rootRouter);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((error, req, res, next) => {
  const statusCode = error.statusCode || 500;

  if (error && error.name === 'MulterError') {
    return res.status(400).json({
      message: error.code === 'LIMIT_FILE_SIZE' ? 'Image file size must be under 5MB' : error.message,
    });
  }

  if (statusCode >= 500) console.error(error);
  res.status(statusCode).json({
    message: error.isOperational ? error.message : 'Internal server error',
  });
});

module.exports = app;
