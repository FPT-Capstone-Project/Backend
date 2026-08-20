const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const userModel = require('../models/user.model');
const AppError = require('../utils/app-error');

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
  if (!normalizedEmail || !password || !fullName || !Number.isInteger(Number(roleId))) {
    throw new AppError('roleId, email, password and fullName are required', 400);
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
      roleId: Number(roleId), email: normalizedEmail, passwordHash, fullName, phone, address,
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
  return { user: sanitizeUser(user), token: createToken(user) };
}

function sanitizeUser(user) {
  const { password_hash: ignoredPasswordHash, ...safeUser } = user;
  return safeUser;
}

module.exports = { register, login, sanitizeUser };
