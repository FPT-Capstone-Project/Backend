const authService = require('../services/auth.service');

async function register(req, res) {
  const result = await authService.register({
    ...req.body,
    fullName: req.body.fullName || req.body.name,
  });
  res.status(201).json({ message: 'Registration successful', ...result });
}

async function login(req, res) {
  const result = await authService.login(req.body);
  res.json({ message: 'Login successful', ...result });
}

function me(req, res) {
  res.json({ user: req.user });
}

module.exports = { register, login, me };

async function registerOtp(req, res) {
  const result = await authService.registerOtp({
    ...req.body,
    name: req.body.name || req.body.fullName,
  });
  res.json(result);
}

async function verifyRegistrationOtp(req, res) {
  const result = await authService.verifyRegistrationOtp(req.body);
  res.json(result);
}

async function forgotPassword(req, res) {
  const result = await authService.forgotPassword(req.body);
  res.json(result);
}

async function resetPasswordOtp(req, res) {
  const result = await authService.resetPasswordOtp(req.body);
  res.json(result);
}

async function requestChangePasswordOtp(req, res) {
  const result = await authService.requestChangePasswordOtp(req.user.user_id);
  res.json(result);
}

async function changePasswordOtp(req, res) {
  const result = await authService.changePasswordOtp(req.user.user_id, req.body);
  res.json(result);
}

module.exports.registerOtp = registerOtp;
module.exports.verifyRegistrationOtp = verifyRegistrationOtp;
module.exports.forgotPassword = forgotPassword;
module.exports.resetPasswordOtp = resetPasswordOtp;
module.exports.requestChangePasswordOtp = requestChangePasswordOtp;
module.exports.changePasswordOtp = changePasswordOtp;
