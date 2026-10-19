const { google } = require('googleapis');
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

const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function createOAuthClient() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    throw new Error('Google OAuth is not configured');
  }
  return new google.auth.OAuth2(
    env.googleClientId,
    env.googleClientSecret,
    env.googleRedirectUri,
  );
}

function createGmailAuthorizationUrl(state) {
  const oauthClient = createOAuthClient();
  return oauthClient.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [GMAIL_SEND_SCOPE],
    state,
  });
}

async function exchangeAuthorizationCode(code) {
  const oauthClient = createOAuthClient();
  const { tokens } = await oauthClient.getToken(code);
  return tokens;
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeMimeBody(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .match(/.{1,76}/g)
    .join('\r\n');
}

function createRawMessage(to, subject, text, html) {
  const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  if (!emailPattern.test(to) || !emailPattern.test(env.gmailSender)) {
    throw new Error('A valid recipient and GMAIL_SENDER email address are required');
  }

  const boundary = `otp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    encodeMimeBody(html),
    `--${boundary}--`,
  ].join('\r\n');

  return encodeBase64Url([
    `From: ${env.gmailSender}`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    body,
  ].join('\r\n'));
}

async function sendOtpEmail(to, otp, type) {
  const message = otpMessages[type];
  if (!message) throw new Error('Unsupported OTP type');

  if (!env.gmailRefreshToken) {
    throw new Error('GMAIL_REFRESH_TOKEN is not configured');
  }
  if (!env.gmailSender) {
    throw new Error('GMAIL_SENDER is not configured');
  }
  const expiryText = `${env.otpExpiryMinutes} minute${env.otpExpiryMinutes === 1 ? '' : 's'}`;
  const text = `${message.text} Your OTP is ${otp}. It expires in ${expiryText}.`;
  const html = `<h2>${message.heading}</h2><p>${message.text}</p><p>Your OTP is <strong>${otp}</strong>.</p><p>This code expires in ${expiryText}.</p>`;
  const oauthClient = createOAuthClient();
  oauthClient.setCredentials({ refresh_token: env.gmailRefreshToken });
  const gmail = google.gmail({ version: 'v1', auth: oauthClient });

  return gmail.users.messages.send({
    userId: 'me',
    requestBody: {
      raw: createRawMessage(to, message.subject, text, html),
    },
  });
}

module.exports = {
  sendOtpEmail,
  createGmailAuthorizationUrl,
  exchangeAuthorizationCode,
};
