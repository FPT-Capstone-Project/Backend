const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const rootRouter = require('./routes/root.routes');
const swaggerRoutes = require('./routes/swagger.routes');

const app = express();

app.use(cors({ origin: env.corsOrigins.includes('*') ? '*' : env.corsOrigins }));
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
  const isInvalidJson = error.type === 'entity.parse.failed';
  const isEntityTooLarge = error.type === 'entity.too.large';
  const statusCode = error.statusCode || (isInvalidJson ? 400 : isEntityTooLarge ? 413 : 500);

  if (error && error.name === 'MulterError') {
    return res.status(400).json({
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'Uploaded file exceeds the allowed size'
        : error.message,
    });
  }

  if (statusCode >= 500) console.error('Lỗi xử lý yêu cầu trên máy chủ:', error);
  const body = {
    message: isInvalidJson
      ? 'Invalid JSON request body'
      : isEntityTooLarge
        ? 'Request body is too large'
        : error.isOperational
          ? error.message
          : 'Internal server error',
  };
  if (error.isOperational && error.code) body.code = error.code;
  res.status(statusCode).json(body);
});

module.exports = app;
