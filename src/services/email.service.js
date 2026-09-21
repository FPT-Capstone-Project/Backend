const nodemailer = require('nodemailer');
const env = require('../config/env');

const otpMessages = {
  REGISTRATION: {
    subject: 'Verify your email address',
    heading: 'Verify your email address',
    text: 'Use this code to complete your registration.',
  },
  FORGOT_PASSWORD: {
    subject: 'Reset your password',
    heading: 'Reset your password',
    text: 'Use this code to reset your password.',
  },
  CHANGE_PASSWORD: {
    subject: 'Confirm your password change',
    heading: 'Confirm your password change',
    text: 'Use this code to confirm your password change.',
  },
};

const transporter = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: env.smtpPort === 465,
  auth: {
    user: env.smtpUser,
    pass: env.smtpPassword,
  },
});

function ensureSmtpConfiguration() {
  if (!env.smtpHost || !env.smtpPort || !env.smtpUser || !env.smtpPassword || !env.smtpFrom) {
    throw new Error('SMTP is not configured');
  }
}

async function sendOtpEmail(to, otp, type) {
  const message = otpMessages[type];
  if (!message) throw new Error('Unsupported OTP type');

  ensureSmtpConfiguration();
  const expiryText = `${env.otpExpiryMinutes} minute${env.otpExpiryMinutes === 1 ? '' : 's'}`;

  return transporter.sendMail({
    from: env.smtpFrom,
    to,
    subject: message.subject,
    text: `${message.text} Your OTP is ${otp}. It expires in ${expiryText}.`,
    html: `<h2>${message.heading}</h2><p>${message.text}</p><p>Your OTP is <strong>${otp}</strong>.</p><p>This code expires in ${expiryText}.</p>`,
  });
}

module.exports = { sendOtpEmail };
