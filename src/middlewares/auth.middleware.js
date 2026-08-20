const jwt = require('jsonwebtoken');
const env = require('../config/env');
const userModel = require('../models/user.model');
const AppError = require('../utils/app-error');
const { sanitizeUser } = require('../services/auth.service');

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new AppError('Bearer token is required', 401);

    const payload = jwt.verify(token, env.jwtSecret);
    const user = await userModel.findById(Number(payload.sub));
    if (!user || user.status !== 'ACTIVE') throw new AppError('User is not authorized', 401);

    req.user = sanitizeUser(user);
    req.auth = payload;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return next(new AppError('Invalid or expired token', 401));
    }
    next(error);
  }
}

function authorizeRoles(...allowedRoleIds) {
  return (req, res, next) => {
    if (!req.user || !allowedRoleIds.includes(Number(req.user.role_id))) {
      return next(new AppError('You do not have permission to access this resource', 403));
    }
    next();
  };
}

module.exports = { authenticate, authorizeRoles };
