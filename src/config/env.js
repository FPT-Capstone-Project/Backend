const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  dbHost: process.env.DB_HOST || 'localhost',
  dbPort: Number(process.env.DB_PORT || 5432),
  dbName: process.env.DB_NAME || 'capstone',
  dbUser: process.env.DB_USER || 'postgres',
  dbPassword: process.env.DB_PASSWORD || '',
  jwtSecret: process.env.JWT_SECRET || 'change-this-development-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1d',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPassword: process.env.SMTP_PASSWORD || '',
  smtpFrom: process.env.SMTP_FROM || '',
  otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
  otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60),
};

if (env.nodeEnv === 'production' && env.jwtSecret === 'change-this-development-secret') {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = env;
