const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const env = require('../config/env');

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

function hashOtp(otp) {
  return bcrypt.hash(otp, 12);
}

function compareOtp(otp, hash) {
  return bcrypt.compare(otp, hash);
}

function getOtpExpiresAt() {
  return new Date(Date.now() + (env.otpExpiryMinutes * 60 * 1000));
}

function getCooldownSecondsRemaining(lastSentAt) {
  if (!lastSentAt) return 0;

  const elapsedMilliseconds = Date.now() - new Date(lastSentAt).getTime();
  const remainingMilliseconds = (env.otpResendCooldownSeconds * 1000) - elapsedMilliseconds;
  return Math.max(0, Math.ceil(remainingMilliseconds / 1000));
}

module.exports = {
  generateOtp,
  hashOtp,
  compareOtp,
  getOtpExpiresAt,
  getCooldownSecondsRemaining,
};
