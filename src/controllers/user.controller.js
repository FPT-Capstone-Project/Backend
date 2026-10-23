const userService = require('../services/user.service');

async function list(req, res) {
  const users = await userService.getUsers(req.query || {});
  res.json({ data: users });
}

async function getById(req, res) {
  const user = await userService.getUserDetail(req.params.userId);
  res.json({ data: user });
}

async function create(req, res) {
  const user = await userService.createUser(req.body || {});
  res.status(201).json({ message: 'User created successfully', data: user });
}

async function updateStatus(req, res) {
  const user = await userService.updateUserStatus(req.params.userId, req.body || {});
  res.json({ message: 'User status updated successfully', data: user });
}

module.exports = { list, getById, create, updateStatus };
