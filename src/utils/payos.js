const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('./app-error');

const PAYOS_API_URL = 'https://api-merchant.payos.vn';

function hasSameValue(expected, actual) {
  const expectedBuffer = Buffer.from(String(expected));
  const actualBuffer = Buffer.from(String(actual));
  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function ensurePayosConfigured() {
  if (!env.payosClientId || !env.payosApiKey || !env.payosChecksumKey) {
    throw new AppError('PayOS is not configured', 503);
  }
}

function sign(value) {
  return crypto
    .createHmac('sha256', env.payosChecksumKey)
    .update(value)
    .digest('hex');
}

function signPaymentRequest({ amount, cancelUrl, description, orderCode, returnUrl }) {
  const data = { amount, cancelUrl, description, orderCode, returnUrl };
  return sign(Object.keys(data).sort().map((key) => `${key}=${data[key]}`).join('&'));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = sortValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function stringifyWebhookValue(value) {
  if (value === null || value === undefined || value === 'null' || value === 'undefined') return '';
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(sortValue(value));
  }
  return String(value);
}

function verifyWebhookSignature(data, signature) {
  if (!env.payosChecksumKey || !data || typeof data !== 'object' || Array.isArray(data)) return false;
  const signedData = Object.keys(data)
    .sort()
    .map((key) => `${key}=${stringifyWebhookValue(data[key])}`)
    .join('&');
  return hasSameValue(sign(signedData), signature || '');
}

async function requestPayos(path, payload) {
  ensurePayosConfigured();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${PAYOS_API_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': env.payosClientId,
        'x-api-key': env.payosApiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new AppError('PayOS returned an invalid response', 502);
    }
    if (!response.ok || result.code !== '00') {
      throw new AppError(result.desc || 'PayOS request failed', 502);
    }
    return result.data;
  } catch (error) {
    if (error.isOperational) throw error;
    throw new AppError(error.name === 'AbortError' ? 'PayOS request timed out' : 'PayOS request failed', 502);
  } finally {
    clearTimeout(timeout);
  }
}

async function createPayosPaymentLink(payload) {
  return requestPayos('/v2/payment-requests', payload);
}

async function confirmPayosWebhook(webhookUrl) {
  return requestPayos('/confirm-webhook', { webhookUrl });
}

module.exports = {
  signPaymentRequest,
  verifyWebhookSignature,
  createPayosPaymentLink,
  confirmPayosWebhook,
};
