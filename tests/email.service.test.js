const test = require('node:test');
const assert = require('node:assert/strict');

const nodemailerPath = require.resolve('nodemailer');
const envPath = require.resolve('../src/config/env');
const emailServicePath = require.resolve('../src/services/email.service');

function loadEmailService(env) {
  const calls = [];
  const originalNodemailer = require.cache[nodemailerPath];
  const originalEnv = require.cache[envPath];
  const originalEmailService = require.cache[emailServicePath];

  delete require.cache[emailServicePath];
  require.cache[envPath] = { exports: env };
  require.cache[nodemailerPath] = {
    exports: {
      createTransport: (options) => ({
        sendMail: async (message) => {
          calls.push({ options, message });
          return { accepted: [message.to] };
        },
      }),
    },
  };

  return {
    service: require('../src/services/email.service'),
    calls,
    restore() {
      if (originalNodemailer) require.cache[nodemailerPath] = originalNodemailer;
      else delete require.cache[nodemailerPath];
      if (originalEnv) require.cache[envPath] = originalEnv;
      else delete require.cache[envPath];
      if (originalEmailService) require.cache[emailServicePath] = originalEmailService;
      else delete require.cache[emailServicePath];
    },
  };
}

const smtpEnv = {
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpUser: 'sender@example.com',
  smtpPassword: 'test-password',
  smtpFrom: 'sender@example.com',
  otpExpiryMinutes: 10,
};

test('sends a registration email with the green SmartMush template through STARTTLS', async (t) => {
  const { service, calls, restore } = loadEmailService(smtpEnv);
  t.after(restore);

  const result = await service.sendOtpEmail('user@example.com', '123456', 'REGISTRATION', 'Khanh Khanh');

  assert.deepEqual(result, { accepted: ['user@example.com'] });
  assert.deepEqual(calls[0].options, {
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: 'sender@example.com', pass: 'test-password' },
  });
  assert.equal(calls[0].message.from, 'sender@example.com');
  assert.equal(calls[0].message.to, 'user@example.com');
  assert.equal(calls[0].message.subject, 'Xác thực tài khoản SmartMush');
  assert.match(calls[0].message.text, /123456/);
  assert.match(calls[0].message.text, /Khanh Khanh/);
  assert.match(calls[0].message.html, /Xác thực địa chỉ email/);
  assert.match(calls[0].message.html, /background-color:#2e7d32/);
  assert.match(calls[0].message.html, /border:2px dashed #43a047/);
  assert.match(calls[0].message.html, /Khanh Khanh/);
  assert.match(calls[0].message.html, /123456/);
  assert.match(calls[0].message.html, /10 phút/);
});

test('uses implicit TLS on SMTP port 465', async (t) => {
  const { service, calls, restore } = loadEmailService({ ...smtpEnv, smtpPort: 465 });
  t.after(restore);

  await service.sendOtpEmail('user@example.com', '123456', 'FORGOT_PASSWORD');

  assert.equal(calls[0].message.subject, 'Yêu cầu đặt lại mật khẩu SmartMush');
  assert.match(calls[0].message.html, /Chúng tôi nhận được yêu cầu đặt lại mật khẩu/);
  assert.equal(calls[0].options.secure, true);
  assert.equal(calls[0].options.requireTLS, false);
});

test('uses change-password copy and escapes the greeting name in HTML', async (t) => {
  const { service, calls, restore } = loadEmailService(smtpEnv);
  t.after(restore);

  await service.sendOtpEmail('user@example.com', '654321', 'CHANGE_PASSWORD', '<script>alert(1)</script>');

  assert.equal(calls[0].message.subject, 'Xác nhận đổi mật khẩu SmartMush');
  assert.match(calls[0].message.html, /Xác nhận đổi mật khẩu/);
  assert.match(calls[0].message.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(calls[0].message.html, /<script>/);
});

test('rejects missing SMTP configuration and invalid recipient addresses', async (t) => {
  const { service, calls, restore } = loadEmailService({ ...smtpEnv, smtpPassword: '' });
  t.after(restore);

  await assert.rejects(
    service.sendOtpEmail('user@example.com', '123456', 'REGISTRATION'),
    /SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM must be configured/,
  );
  assert.equal(calls.length, 0);

  const invalidRecipient = loadEmailService(smtpEnv);
  t.after(invalidRecipient.restore);
  await assert.rejects(
    invalidRecipient.service.sendOtpEmail('invalid-address', '123456', 'REGISTRATION'),
    /valid recipient email address/,
  );
  assert.equal(invalidRecipient.calls.length, 0);
});
