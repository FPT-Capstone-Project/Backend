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

  payosClientId: process.env.PAYOS_CLIENT_ID || '',
  payosApiKey: process.env.PAYOS_API_KEY || '',
  payosChecksumKey: process.env.PAYOS_CHECKSUM_KEY || '',
  payosReturnUrl: process.env.PAYOS_RETURN_URL || '',
  payosCancelUrl: process.env.PAYOS_CANCEL_URL || '',
  payosPaymentExpireMinutes: Number(process.env.PAYOS_PAYMENT_EXPIRE_MINUTES || 15),
  payosWebhookUrl: process.env.PAYOS_WEBHOOK_URL || '',

};

if (env.nodeEnv === 'production' && env.jwtSecret === 'change-this-development-secret') {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = env;
