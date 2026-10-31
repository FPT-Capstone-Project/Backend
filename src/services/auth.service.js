const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const userModel = require('../models/user.model');
const AppError = require('../utils/app-error');
const { sendOtpEmail } = require('./email.service');
const {
  generateOtp,
  hashOtp,
  compareOtp,
  getOtpExpiresAt,
  getCooldownSecondsRemaining,
} = require('../utils/otp.util');

function createToken(user) {
  return jwt.sign(
    { sub: String(user.user_id), roleId: user.role_id },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn },
  );
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

async function register({ roleId, email, password, fullName, phone, address }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password || !fullName) {
    throw new AppError('email, password and fullName are required', 400);
  }
  let selectedRoleId = DEFAULT_CUSTOMER_ROLE_ID;
  if (roleId !== undefined) {
    if (!Number.isInteger(roleId) || roleId < 1) {
      throw new AppError('roleId must be a positive integer', 400);
    }
    selectedRoleId = roleId;
  }
  if (password.length < 8) {
    throw new AppError('Password must be at least 8 characters', 400);
  }
  if (await userModel.findByEmail(normalizedEmail)) {
    throw new AppError('Email is already registered', 409);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    const user = await userModel.create({
      roleId: selectedRoleId, email: normalizedEmail, passwordHash, fullName, phone, address,
    });
    return { user, token: createToken(user) };
  } catch (error) {
    if (error.code === '23505') throw new AppError('Email is already registered', 409);
    if (error.code === '23503') throw new AppError('The selected role does not exist', 400);
    throw error;
  }
}

async function login({ email, password }) {
  const user = await userModel.findByEmail(normalizeEmail(email));
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    throw new AppError('Invalid email or password', 401);
  }
  if (user.status !== 'ACTIVE') throw new AppError('User account is not active', 403);
  if (user.is_email_verified === false) throw new AppError('Email chưa được xác thực', 403);
  return { user: sanitizeUser(user), token: createToken(user) };
}

function sanitizeUser(user) {
  const { password_hash: ignoredPasswordHash, ...safeUser } = user;
  return safeUser;
}

module.exports = { register, login, sanitizeUser };

const DEFAULT_CUSTOMER_ROLE_ID = 3;
const OTP_TYPES = {
  REGISTRATION: 'REGISTRATION',
  FORGOT_PASSWORD: 'FORGOT_PASSWORD',
  CHANGE_PASSWORD: 'CHANGE_PASSWORD',
};
const OTP_MAX_ATTEMPTS = Number.isInteger(env.otpMaxAttempts) && env.otpMaxAttempts > 0
  ? env.otpMaxAttempts
  : 5;
const INVALID_OTP_MESSAGE = 'OTP không hợp lệ hoặc đã hết hạn';
const TOO_MANY_OTP_ATTEMPTS_MESSAGE = 'nhập sai quá nhiều lần, vui lòng yêu cầu mã mới';
const FORGOT_PASSWORD_MESSAGE = 'If the email exists and is eligible, an OTP has been sent.';

function sanitizeOtpUser(user) {
  const {
    otp_code: ignoredOtpCode,
    otp_type: ignoredOtpType,
    otp_expires_at: ignoredOtpExpiresAt,
    otp_attempts: ignoredOtpAttempts,
    otp_last_sent_at: ignoredOtpLastSentAt,
    ...safeUser
  } = sanitizeUser(user);
  return safeUser;
}

function validatePassword(password, fieldName = 'password') {
  if (typeof password !== 'string' || password.length < 6) {
    throw new AppError(`${fieldName} must be at least 6 characters`, 400);
  }
}

function createCooldownError(seconds) {
  return new AppError(`Please wait ${seconds} seconds before requesting another OTP`, 429);
}

async function sendOtpToUser(user, type) {
  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const savedUser = await userModel.saveOtp(
    user.user_id,
    otpHash,
    type,
    getOtpExpiresAt(),
    env.otpResendCooldownSeconds,
  );
  if (!savedUser) {
    const currentUser = await userModel.findOtpUserById(user.user_id);
    if (!currentUser) throw new AppError('User not found', 404);
    throw createCooldownError(Math.max(1, getCooldownSecondsRemaining(currentUser.otp_last_sent_at)));
  }

  try {
    await sendOtpEmail(user.email, otp, type, user.full_name);
  } catch (error) {
    await userModel.clearOtp(user.user_id);
    throw new AppError('Unable to send OTP email', 500);
  }

  return { email: user.email, email_delivery: 'sent' };
}

async function verifyUserOTP(user, otp, expectedType) {
  const expiresAt = user && user.otp_expires_at ? new Date(user.otp_expires_at) : null;
  if (!user
    || !user.otp_code
    || user.otp_type !== expectedType
    || !expiresAt
    || Number.isNaN(expiresAt.getTime())
    || expiresAt.getTime() <= Date.now()) {
    throw new AppError(INVALID_OTP_MESSAGE, 400);
  }
  if (Number(user.otp_attempts) >= OTP_MAX_ATTEMPTS) {
    throw new AppError(TOO_MANY_OTP_ATTEMPTS_MESSAGE, 429);
  }
  if (typeof otp !== 'string' || !(await compareOtp(otp, user.otp_code))) {
    await userModel.incrementOtpAttempts(user.user_id);
    throw new AppError(INVALID_OTP_MESSAGE, 400);
  }
  return user;
}

async function registerOtp({ name, email, password, phone, address }) {
  const normalizedEmail = normalizeEmail(email);
  const fullName = typeof name === 'string' ? name.trim() : '';
  if (!fullName || !normalizedEmail || typeof password !== 'string') {
    throw new AppError('name, email and password are required', 400);
  }
  validatePassword(password);

  let user = await userModel.findOtpUserByEmail(normalizedEmail);
  if (user && user.is_email_verified) {
    throw new AppError('Email is already registered', 409);
  }
  if (user) {
    const cooldownSeconds = getCooldownSecondsRemaining(user.otp_last_sent_at);
    if (cooldownSeconds > 0) throw createCooldownError(cooldownSeconds);

    const passwordHash = await bcrypt.hash(password, 12);
    user = await userModel.updateUnverifiedUser({
      userId: user.user_id, passwordHash, fullName, phone, address,
    });
    if (!user) throw new AppError('Email is already registered', 409);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    try {
      user = await userModel.createUnverifiedUser({
        roleId: DEFAULT_CUSTOMER_ROLE_ID,
        email: normalizedEmail,
        passwordHash,
        fullName,
        phone,
        address,
      });
    } catch (error) {
      if (error.code === '23505') throw new AppError('Email is already registered', 409);
      throw error;
    }
  }

  const delivery = await sendOtpToUser(user, OTP_TYPES.REGISTRATION);
  return { success: true, message: 'OTP sent to your email.', ...delivery };
}

async function verifyRegistrationOtp({ email, otp }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof otp !== 'string' || !otp) {
    throw new AppError('email and otp are required', 400);
  }

  const user = await userModel.findOtpUserByEmail(normalizedEmail);
  await verifyUserOTP(user, otp, OTP_TYPES.REGISTRATION);
  const verifiedUser = await userModel.markEmailVerified(user.user_id, user.otp_code);
  if (!verifiedUser) throw new AppError(INVALID_OTP_MESSAGE, 400);
  return {
    success: true,
    message: 'Email verified successfully.',
    user: sanitizeOtpUser(verifiedUser),
  };
}

async function forgotPassword({ email }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) throw new AppError('email is required', 400);

  const response = {
    success: true,
    message: FORGOT_PASSWORD_MESSAGE,
    email: normalizedEmail,
    email_delivery: 'accepted',
  };
  const user = await userModel.findOtpUserByEmail(normalizedEmail);
  if (!user || user.status !== 'ACTIVE' || !user.is_email_verified) return response;
  if (getCooldownSecondsRemaining(user.otp_last_sent_at) > 0) return response;

  try {
    await sendOtpToUser(user, OTP_TYPES.FORGOT_PASSWORD);
  } catch (error) {
    // Keep this response indistinguishable from an unknown email address.
  }
  return response;
}

async function resetPasswordOtp({ email, otp, new_password: newPassword }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || typeof otp !== 'string' || !otp || typeof newPassword !== 'string') {
    throw new AppError('email, otp and new_password are required', 400);
  }
  validatePassword(newPassword, 'new_password');

  const user = await userModel.findOtpUserByEmail(normalizedEmail);
  await verifyUserOTP(user, otp, OTP_TYPES.FORGOT_PASSWORD);
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const updatedUser = await userModel.updatePasswordAndClearOtp(
    user.user_id,
    passwordHash,
    user.otp_code,
  );
  if (!updatedUser) throw new AppError(INVALID_OTP_MESSAGE, 400);
  return {
    success: true,
    message: 'Password reset successfully.',
    user: sanitizeOtpUser(updatedUser),
  };
}

async function requestChangePasswordOtp(userId) {
  const user = await userModel.findOtpUserById(userId);
  if (!user) throw new AppError('User not found', 404);

  const cooldownSeconds = getCooldownSecondsRemaining(user.otp_last_sent_at);
  if (cooldownSeconds > 0) throw createCooldownError(cooldownSeconds);

  const delivery = await sendOtpToUser(user, OTP_TYPES.CHANGE_PASSWORD);
  return { success: true, message: 'OTP sent to your email.', ...delivery };
}

async function changePasswordOtp(userId, { otp, new_password: newPassword }) {
  if (typeof otp !== 'string' || !otp || typeof newPassword !== 'string') {
    throw new AppError('otp and new_password are required', 400);
  }
  validatePassword(newPassword, 'new_password');

  const user = await userModel.findOtpUserById(userId);
  if (!user) throw new AppError('User not found', 404);

  await verifyUserOTP(user, otp, OTP_TYPES.CHANGE_PASSWORD);
  if (await bcrypt.compare(newPassword, user.password_hash)) {
    throw new AppError('New password must be different from the current password', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  const updatedUser = await userModel.updatePasswordAndClearOtp(
    user.user_id,
    passwordHash,
    user.otp_code,
  );
  if (!updatedUser) throw new AppError(INVALID_OTP_MESSAGE, 400);
  return {
    success: true,
    message: 'Password changed successfully.',
    user: sanitizeOtpUser(updatedUser),
  };
}

module.exports.registerOtp = registerOtp;
module.exports.verifyRegistrationOtp = verifyRegistrationOtp;
module.exports.forgotPassword = forgotPassword;
module.exports.resetPasswordOtp = resetPasswordOtp;
module.exports.requestChangePasswordOtp = requestChangePasswordOtp;
module.exports.changePasswordOtp = changePasswordOtp;
module.exports.verifyUserOTP = verifyUserOTP;
