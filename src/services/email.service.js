const nodemailer = require('nodemailer');
const env = require('../config/env');

const otpMessages = {
  REGISTRATION: {
    subject: 'Xác thực tài khoản SmartMush',
    heading: 'Xác thực địa chỉ email',
    text: 'Cảm ơn bạn đã đăng ký tài khoản SmartMush. Vui lòng nhập mã xác thực bên dưới để hoàn tất đăng ký.',
    notice: 'Nếu bạn không đăng ký tài khoản, vui lòng bỏ qua email này.',
  },
  FORGOT_PASSWORD: {
    subject: 'Yêu cầu đặt lại mật khẩu SmartMush',
    heading: 'Đặt lại mật khẩu',
    text: 'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản SmartMush của bạn. Nhập mã bên dưới để tiếp tục.',
    notice: 'Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này. Mật khẩu hiện tại của bạn vẫn được giữ nguyên.',
  },
  CHANGE_PASSWORD: {
    subject: 'Xác nhận đổi mật khẩu SmartMush',
    heading: 'Xác nhận đổi mật khẩu',
    text: 'Bạn đã yêu cầu đổi mật khẩu tài khoản SmartMush. Nhập mã bên dưới để xác nhận thay đổi.',
    notice: 'Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email và giữ an toàn cho tài khoản của mình.',
  },
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createOtpEmailHtml({ heading, text: messageText, notice, otp, expiryText, fullName }) {
  const greeting = fullName
    ? `<p style="margin:0 0 16px;color:#424242;font-size:14px;line-height:1.6;">Xin chào <strong>${escapeHtml(fullName)}</strong>,</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="vi">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:24px 12px;background-color:#f4f6f4;font-family:Arial,Helvetica,sans-serif;color:#333333;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:100%;max-width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:10px;overflow:hidden;">
            <tr>
              <td align="center" style="padding:28px 20px;background-color:#2e7d32;color:#ffffff;">
                <div style="font-size:26px;font-weight:700;letter-spacing:0.3px;">SmartMush</div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 30px 26px;text-align:center;">
                <h1 style="margin:0 0 18px;color:#2e7d32;font-size:22px;line-height:1.35;">${escapeHtml(heading)}</h1>
                ${greeting}
                <p style="margin:0 0 24px;color:#424242;font-size:14px;line-height:1.7;">${escapeHtml(messageText)}</p>
                <div style="padding:24px 12px;border:2px dashed #43a047;border-radius:10px;background-color:#f1f8f2;color:#2e7d32;font-size:34px;font-weight:700;letter-spacing:10px;line-height:1.2;">
                  ${escapeHtml(otp)}
                </div>
                <p style="margin:22px 0 12px;color:#777777;font-size:14px;line-height:1.6;">Mã này sẽ hết hạn sau ${escapeHtml(expiryText)}. Không chia sẻ mã này với bất kỳ ai.</p>
                <p style="margin:0;color:#777777;font-size:14px;line-height:1.6;">${escapeHtml(notice)}</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:18px 24px;background-color:#f1f8f2;color:#777777;font-size:12px;line-height:1.6;">
                Email này được gửi tự động từ SmartMush. Vui lòng không trả lời email này.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendOtpEmail(to, otp, type, fullName) {
  const message = otpMessages[type];
  if (!message) throw new Error('Unsupported OTP type');

  if (!env.smtpHost || !env.smtpUser || !env.smtpPassword || !env.smtpFrom) {
    throw new Error('SMTP_HOST, SMTP_USER, SMTP_PASSWORD and SMTP_FROM must be configured');
  }
  if (!Number.isInteger(env.smtpPort) || env.smtpPort < 1 || env.smtpPort > 65535) {
    throw new Error('SMTP_PORT must be a valid port number');
  }
  const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  if (!emailPattern.test(to)) {
    throw new Error('A valid recipient email address is required');
  }

  const expiryText = `${env.otpExpiryMinutes} phút`;
  const text = [
    message.heading,
    fullName ? `Xin chào ${fullName},` : '',
    message.text,
    `Mã xác thực của bạn là ${otp}. Mã này sẽ hết hạn sau ${expiryText}.`,
    'Không chia sẻ mã này với bất kỳ ai.',
    message.notice,
    'Email này được gửi tự động từ SmartMush. Vui lòng không trả lời email này.',
  ].filter(Boolean).join('\n\n');
  const html = createOtpEmailHtml({
    ...message,
    otp,
    expiryText,
    fullName,
  });

  const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpPort === 465,
    requireTLS: env.smtpPort !== 465,
    auth: {
      user: env.smtpUser,
      pass: env.smtpPassword,
    },
  });

  return transporter.sendMail({
    from: env.smtpFrom,
    to,
    subject: message.subject,
    text,
    html,
  });
}

module.exports = {
  sendOtpEmail,
};
