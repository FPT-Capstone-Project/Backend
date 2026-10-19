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

  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || '',
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || '',

  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  gmailRefreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
  gmailSender: process.env.GMAIL_SENDER || '',
  otpExpiryMinutes: Number(process.env.OTP_EXPIRY_MINUTES || 10),
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
  otpResendCooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60),

  sepayBankCode: process.env.SEPAY_BANK_CODE || '',
  sepayAccountNumber: process.env.SEPAY_ACCOUNT_NUMBER || '',
  sepayQrTemplate: process.env.SEPAY_QR_TEMPLATE || 'compact',
  sepayWebhookSecret: process.env.SEPAY_WEBHOOK_SECRET || '',
  sepayWebhookMaxAgeSeconds: Number(process.env.SEPAY_WEBHOOK_MAX_AGE_SECONDS || 300),

};

if (env.nodeEnv === 'production' && env.jwtSecret === 'change-this-development-secret') {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = env;
